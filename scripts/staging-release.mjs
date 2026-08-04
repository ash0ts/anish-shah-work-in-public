import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertActiveActionsWorkflow,
  assertRequiredValidationRuns,
  assertSimulationReleaseRecord,
  assertVerifiedActionsRun,
  exactMigrationNames,
  exactVersionIds,
  githubRepositoryFromRemoteUrl,
  requireExactUploadedVersion,
  REQUIRED_VALIDATION_RUNS,
  runGuardedMigration,
  simulationReleaseRecord,
} from "./lib/release-contract.mjs";
import {
  assertStagingConfiguration,
  expectedStagingCoordinates,
  STAGING_SITE_ORIGIN,
  STAGING_WORKER_NAME,
} from "./lib/hosted-config-contract.mjs";
import { readVerifiedDeployableArtifactManifest } from "./lib/deployable-artifact-contract.mjs";
import {
  RELEASE_BUILD_CHECKPOINT_PATH,
  verifyReleaseBuildCheckpoint,
} from "./lib/release-build-checkpoint.mjs";
import {
  fetchWithTimeout,
  stagingSmokePaths,
  waitForReadOnlyStagingReadiness,
} from "./lib/staging-http-contract.mjs";
import { buildCopyDeck } from "./lib/copy-deck.mjs";

const root = process.cwd();
const configPath = path.join(root, "dist/server/wrangler.staging.json");
const planPath = path.join(root, "dist/staging-release-plan.json");
const wranglerPath = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const action = process.argv[2];
const supported = new Set([
  "plan", "migrate", "upload", "deploy", "bootstrap", "checkpoint", "smoke", "rollback",
]);
if (!supported.has(action)) {
  throw new Error("Use staging-release.mjs plan, migrate, upload, deploy, bootstrap, checkpoint, smoke, or rollback.");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a guarded staging command.`);
  return value;
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} ${arguments_.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function git(...arguments_) {
  return run("git", arguments_).trim();
}

function wrangler(...arguments_) {
  return run(process.execPath, [wranglerPath, ...arguments_]);
}

function repository() {
  const branch = git("branch", "--show-current");
  const remote = git("config", "--get", `branch.${branch}.remote`);
  if (!branch || !remote || remote === ".") {
    throw new Error("The staging branch must track a GitHub remote.");
  }
  return githubRepositoryFromRemoteUrl(git("remote", "get-url", "--push", remote));
}

function verifyGitState() {
  const head = git("rev-parse", "HEAD");
  if (git("status", "--porcelain=v1", "--untracked-files=all")) {
    throw new Error("Staging commands require a clean worktree.");
  }
  if (git("rev-parse", "@{upstream}") !== head) {
    throw new Error("Staging HEAD must be pushed to its configured upstream.");
  }
  if (required("STAGING_VALIDATED_SHA") !== head) {
    throw new Error("STAGING_VALIDATED_SHA must equal the exact HEAD being staged.");
  }
  if (process.env.RELEASE_VALIDATED_SHA && process.env.RELEASE_VALIDATED_SHA !== head) {
    throw new Error("A conflicting production RELEASE_VALIDATED_SHA is present.");
  }
  if (process.env.LOCAL_OWNER_EMAIL?.trim()) {
    throw new Error("LOCAL_OWNER_EMAIL must not be present in a staging shell.");
  }
  return head;
}

async function configState(head) {
  const [configBytes, bundleBytes, simulationManifestBytes, artifactResult] = await Promise.all([
    readFile(configPath),
    readFile(path.join(root, "content/public/anish-content.public.v1.json")),
    readFile(path.join(root, "content/presentation/simulation.v1.json")),
    readVerifiedDeployableArtifactManifest(root),
  ]);
  const config = JSON.parse(configBytes);
  const bundle = JSON.parse(bundleBytes);
  const simulationManifest = JSON.parse(simulationManifestBytes);
  const stagingEnvironment = {
    ...process.env,
    RELEASE_VALIDATED_SHA: head,
  };
  const expected = expectedStagingCoordinates(
    stagingEnvironment,
    bundle.contentVersion,
  );
  assertStagingConfiguration(config, expected);
  if (config.name !== STAGING_WORKER_NAME || config.routes?.[0]?.pattern !== new URL(STAGING_SITE_ORIGIN).hostname) {
    throw new Error("The staging command refused a non-staging Worker or route.");
  }
  return {
    config,
    configBytes,
    bundle,
    simulationManifest,
    simulationManifestBytes,
    artifactResult,
  };
}

function verifiedRuns(head, configuredRepository) {
  const validationEnvironmentNames = new Map([
    ["validate", "STAGING_VALIDATION_URL"],
    ["gitleaks", "STAGING_GITLEAKS_URL"],
    ["codeql", "STAGING_CODEQL_URL"],
    ["browser", "STAGING_BROWSER_URL"],
  ]);
  return REQUIRED_VALIDATION_RUNS.map(({ kind, name, workflowPath }) => {
    const environmentName = validationEnvironmentNames.get(kind);
    const url = new URL(required(environmentName));
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      segments.length !== 5 ||
      segments[2] !== "actions" ||
      segments[3] !== "runs" ||
      !/^\d+$/.test(segments[4]) ||
      `${segments[0].toLowerCase()}/${segments[1].toLowerCase()}` !== configuredRepository
    ) {
      throw new Error(`${environmentName} must be an Actions run for the configured repository.`);
    }
    const result = run("gh", [
      "run", "view", segments[4], "--repo", `${segments[0]}/${segments[1]}`,
      "--json", "headSha,conclusion,url,name,event,workflowDatabaseId",
    ]);
    const evidence = JSON.parse(result);
    assertVerifiedActionsRun(evidence, { head, url: url.toString(), name });
    if (
      !Number.isSafeInteger(evidence.workflowDatabaseId) ||
      evidence.workflowDatabaseId < 1
    ) {
      throw new Error(`${name} evidence has no valid workflow identity.`);
    }
    let workflow;
    try {
      workflow = JSON.parse(run("gh", [
        "api",
        `repos/${segments[0]}/${segments[1]}/actions/workflows/${evidence.workflowDatabaseId}`,
      ]));
    } catch {
      throw new Error(`${name} workflow identity could not be verified.`);
    }
    const workflowIdentity = assertActiveActionsWorkflow(workflow, {
      workflowDatabaseId: evidence.workflowDatabaseId,
      name,
      workflowPath,
    });
    return {
      kind,
      name,
      ...evidence,
      ...workflowIdentity,
    };
  });
}

async function writePlan() {
  const head = verifyGitState();
  const {
    config,
    configBytes,
    bundle,
    simulationManifest,
    simulationManifestBytes,
    artifactResult,
  } = await configState(head);
  const [releaseBuildCheckpoint, releaseBuildCheckpointBytes] =
    await Promise.all([
      verifyReleaseBuildCheckpoint(root),
      readFile(path.join(root, RELEASE_BUILD_CHECKPOINT_PATH)),
    ]);
  if (
    releaseBuildCheckpoint.artifactSetSha256 !==
      artifactResult.manifest.artifactSetSha256 ||
    releaseBuildCheckpoint.deployableManifestSha256 !==
      sha256(artifactResult.bytes)
  ) {
    throw new Error("The tested release-build checkpoint does not match this staging artifact set.");
  }
  const configuredRepository = repository();
  const validationRuns = verifiedRuns(head, configuredRepository);
  assertRequiredValidationRuns(validationRuns, head, configuredRepository);
  const previousWorkerVersion = required("STAGING_PREVIOUS_WORKER_VERSION");
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(previousWorkerVersion)) {
    throw new Error("STAGING_PREVIOUS_WORKER_VERSION is invalid.");
  }
  const bookmark = required("STAGING_D1_BOOKMARK");
  if (!/^[A-Za-z0-9._~+/=-]{8,512}$/.test(bookmark)) {
    throw new Error("STAGING_D1_BOOKMARK contains unexpected characters.");
  }
  const migrationNames = (process.env.STAGING_MIGRATION_LIST ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const available = new Set((await readdir(path.join(root, "drizzle"))).filter((name) => name.endsWith(".sql")));
  if (
    new Set(migrationNames).size !== migrationNames.length ||
    migrationNames.some((name) => !/^\d{4}_[a-z0-9_]+\.sql$/i.test(name) || !available.has(name))
  ) {
    throw new Error("STAGING_MIGRATION_LIST must name unique checked-in migrations.");
  }
  const migrations = await Promise.all(migrationNames.map(async (name) => ({
    name,
    sha256: sha256(await readFile(path.join(root, "drizzle", name))),
  })));
  const { copyVersion } = await buildCopyDeck(root);
  const simulation = simulationReleaseRecord({
    campaignVersion: simulationManifest.campaignVersion,
    experienceMode: config.vars?.SIMULATION_EXPERIENCE_MODE,
    aiMode: config.vars?.SIMULATION_AI_MODE,
    provider: config.vars?.SIMULATION_PROVIDER,
    model: config.vars?.SIMULATION_MODEL,
    approvedProviders: process.env.STAGING_SIMULATION_APPROVED_PROVIDERS,
    approvalStateDigest: process.env.STAGING_SIMULATION_APPROVAL_DIGEST,
  });
  const plan = {
    schemaVersion: "1.2",
    deploymentTier: "staging",
    preparedAt: new Date().toISOString(),
    commitSha: head,
    repository: configuredRepository,
    workerName: STAGING_WORKER_NAME,
    siteUrl: STAGING_SITE_ORIGIN,
    contentVersion: bundle.contentVersion,
    playExperienceMode: config.vars.PLAY_EXPERIENCE_MODE,
    copyVersion,
    simulation,
    previousWorkerVersion,
    d1: { preMigrationBookmark: bookmark, migrations },
    validationRuns,
    releaseBuildCheckpoint: {
      sha256: sha256(releaseBuildCheckpointBytes),
      artifactSetSha256: releaseBuildCheckpoint.artifactSetSha256,
      deployableManifestSha256:
        releaseBuildCheckpoint.deployableManifestSha256,
    },
    checksums: {
      preparedWorkerConfigSha256: sha256(configBytes),
      simulationCampaignManifestSha256: sha256(simulationManifestBytes),
      deployableArtifactManifestSha256: sha256(artifactResult.bytes),
      deployableArtifactSetSha256: artifactResult.manifest.artifactSetSha256,
      releaseBuildCheckpointSha256: sha256(releaseBuildCheckpointBytes),
    },
  };
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  console.log("Wrote ignored dist/staging-release-plan.json.");
}

async function verifyPlan() {
  const head = verifyGitState();
  const {
    config,
    configBytes,
    bundle,
    simulationManifest,
    simulationManifestBytes,
    artifactResult,
  } = await configState(head);
  const [plan, releaseBuildCheckpoint, releaseBuildCheckpointBytes] =
    await Promise.all([
      readFile(planPath, "utf8").then(JSON.parse),
      verifyReleaseBuildCheckpoint(root),
      readFile(path.join(root, RELEASE_BUILD_CHECKPOINT_PATH)),
    ]);
  const { copyVersion } = await buildCopyDeck(root);
  if (
    plan.schemaVersion !== "1.2" ||
    plan.deploymentTier !== "staging" ||
    plan.commitSha !== head ||
    plan.repository !== repository() ||
    plan.workerName !== STAGING_WORKER_NAME ||
    plan.siteUrl !== STAGING_SITE_ORIGIN ||
    plan.contentVersion !== bundle.contentVersion ||
    plan.playExperienceMode !== config.vars?.PLAY_EXPERIENCE_MODE ||
    plan.playExperienceMode !== "my-room-2001" ||
    plan.copyVersion !== copyVersion ||
    plan.checksums?.preparedWorkerConfigSha256 !== sha256(configBytes) ||
    plan.checksums?.simulationCampaignManifestSha256 !==
      sha256(simulationManifestBytes) ||
    plan.checksums?.deployableArtifactManifestSha256 !== sha256(artifactResult.bytes) ||
    plan.checksums?.deployableArtifactSetSha256 !== artifactResult.manifest.artifactSetSha256
    || plan.releaseBuildCheckpoint?.sha256 !== sha256(releaseBuildCheckpointBytes)
    || plan.releaseBuildCheckpoint?.artifactSetSha256 !== releaseBuildCheckpoint.artifactSetSha256
    || plan.releaseBuildCheckpoint?.deployableManifestSha256 !== releaseBuildCheckpoint.deployableManifestSha256
    || plan.checksums?.releaseBuildCheckpointSha256 !== sha256(releaseBuildCheckpointBytes)
    || releaseBuildCheckpoint.artifactSetSha256 !== artifactResult.manifest.artifactSetSha256
    || releaseBuildCheckpoint.deployableManifestSha256 !== sha256(artifactResult.bytes)
  ) {
    throw new Error("The staging release plan is stale or crossed an environment boundary.");
  }
  assertSimulationReleaseRecord(plan.simulation, {
    config,
    campaignVersion: simulationManifest.campaignVersion,
  });
  assertRequiredValidationRuns(plan.validationRuns, head, plan.repository);
  for (const migration of plan.d1?.migrations ?? []) {
    if (sha256(await readFile(path.join(root, "drizzle", migration.name))) !== migration.sha256) {
      throw new Error(`Migration ${migration.name} changed after staging planning.`);
    }
  }
  return { head, plan };
}

async function pendingMigrations() {
  return exactMigrationNames(
    wrangler("d1", "migrations", "list", "DB", "--remote", "--config", configPath),
  );
}

async function authenticatedFetch(
  pathname,
  init = {},
  consumeResponse = (response) => response,
) {
  const jwt = required("STAGING_ACCESS_JWT");
  if (jwt.length > 16_384 || /\s/.test(jwt)) throw new Error("STAGING_ACCESS_JWT is malformed.");
  const { timeoutMs, ...requestInit } = init;
  return fetchWithTimeout(
    fetch,
    new URL(pathname, STAGING_SITE_ORIGIN),
    {
      ...requestInit,
      redirect: "manual",
      headers: {
        ...requestInit.headers,
        cookie: `CF_Authorization=${jwt}`,
        origin: STAGING_SITE_ORIGIN,
      },
    },
    timeoutMs,
    consumeResponse,
  );
}

async function authenticatedJson(pathname, init = {}) {
  return authenticatedFetch(pathname, init, async (response) => ({
    response,
    body: await response.json().catch(() => null),
  }));
}

async function waitForCandidateReadiness(head, contentVersion) {
  return waitForReadOnlyStagingReadiness({
    check: async (timeoutMs) => {
      const { response, body } = await authenticatedJson("/api/studio/health", {
        method: "GET",
        timeoutMs,
      });
      if (!response.ok) return false;
      return body?.releaseSha === head && body?.contentVersion === contentVersion;
    },
  });
}

async function waitForPublicationReadiness(contentVersion) {
  let checkpoint = null;
  await waitForReadOnlyStagingReadiness({
    check: async (timeoutMs) => {
      const { response, body } = await authenticatedJson(
        "/api/studio/publication-checkpoint",
        { method: "GET", timeoutMs },
      );
      checkpoint = response.ok ? body : null;
      return (
        response.ok &&
        checkpoint?.status === "ready" &&
        checkpoint?.contentVersion === contentVersion &&
        checkpoint?.kvPointerMatches === true
      );
    },
  });
  return checkpoint;
}

if (action === "plan") {
  await writePlan();
} else {
  const { head, plan } = await verifyPlan();
  if (action === "migrate") {
    await runGuardedMigration({
      planned: plan.d1.migrations.map((entry) => entry.name),
      listPending: pendingMigrations,
      apply: async () => process.stdout.write(
        wrangler("d1", "migrations", "apply", "DB", "--remote", "--config", configPath),
      ),
    });
  } else if (action === "upload") {
    const pending = await pendingMigrations();
    if (pending.length) throw new Error(`Apply staging migrations first: ${pending.join(", ")}.`);
    process.stdout.write(wrangler(
      "versions", "upload", "--config", configPath, "--message", head, "--tag", head, "--strict",
    ));
  } else if (action === "deploy" || action === "rollback") {
    const requested = action === "rollback"
      ? plan.previousWorkerVersion
      : required("STAGING_WORKER_VERSION");
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(requested)) throw new Error("The staging Worker version is invalid.");
    const available = exactVersionIds(wrangler("versions", "list", "--config", configPath));
    requireExactUploadedVersion(available.join("\n"), requested);
    if (action === "deploy") {
      if (requested === plan.previousWorkerVersion) throw new Error("The candidate equals the prior staging version.");
      process.stdout.write(wrangler("triggers", "deploy", "--config", configPath));
    }
    process.stdout.write(wrangler("versions", "deploy", `${requested}@100%`, "--config", configPath, "--yes"));
  } else if (action === "bootstrap") {
    await waitForCandidateReadiness(head, plan.contentVersion);
    const { response: before, body: existing } = await authenticatedJson(
      "/api/studio/publication-checkpoint",
    );
    if (!before.ok) {
      throw new Error("Staging publication state could not be read; no publish was attempted.");
    }
    if (
      before.ok &&
      existing?.status === "ready" &&
      existing?.contentVersion === plan.contentVersion &&
      existing?.kvPointerMatches === true
    ) {
      console.log(JSON.stringify({ status: "already_ready", contentVersion: existing.contentVersion }));
    } else {
      const { response: published, body: publication } = await authenticatedJson(
        "/api/studio/publish",
        { method: "POST" },
      );
      if (!published.ok || publication?.publication?.recordCount < 1) {
        throw new Error("Staging publication bootstrap failed.");
      }
      const checkpoint = await waitForPublicationReadiness(plan.contentVersion);
      console.log(JSON.stringify({
        status: "published",
        recordCount: publication.publication.recordCount,
        contentVersion: checkpoint.contentVersion,
      }));
    }
  } else if (action === "checkpoint") {
    await waitForCandidateReadiness(head, plan.contentVersion);
    const { response, body } = await authenticatedJson("/api/studio/health");
    if (!response.ok || body?.releaseSha !== head || body?.contentVersion !== plan.contentVersion) {
      throw new Error("Staging health does not match the planned SHA and content version.");
    }
    const simulation = body?.simulation;
    if (
      !simulation ||
      simulation.campaignVersion !== plan.simulation.campaignVersion ||
      simulation.experienceMode !== plan.simulation.experienceMode ||
      simulation.aiMode !== plan.simulation.aiMode ||
      simulation.provider !== plan.simulation.provider ||
      simulation.model !== plan.simulation.model ||
      (plan.simulation.experienceMode === "campaign-v1" &&
        (simulation.configured !== true ||
          simulation.providerApprovalDigest !==
            plan.simulation.approvalStateDigest ||
          JSON.stringify(simulation.approvedProviders) !==
            JSON.stringify(plan.simulation.approvedProviders)))
    ) {
      throw new Error(
        "Staging simulation configuration or provider approvals do not match the plan.",
      );
    }
    const {
      response: publicationResponse,
      body: publication,
    } = await authenticatedJson("/api/studio/publication-checkpoint");
    if (
      !publicationResponse.ok ||
      publication?.status !== "ready" ||
      publication?.contentVersion !== plan.contentVersion ||
      publication?.kvPointerMatches !== true
    ) {
      throw new Error("Staging publication checkpoint is not ready.");
    }
    console.log(JSON.stringify({
      status: "ready",
      releaseSha: body.releaseSha,
      contentVersion: body.contentVersion,
      kvPointerMatches: true,
      simulation: {
        campaignVersion: simulation.campaignVersion,
        experienceMode: simulation.experienceMode,
        aiMode: simulation.aiMode,
        provider: simulation.provider,
        model: simulation.model,
        configured: simulation.configured,
        approvedProviders: simulation.approvedProviders,
      },
    }));
  } else if (action === "smoke") {
    await waitForCandidateReadiness(head, plan.contentVersion);
    const results = [];
    for (const pathname of stagingSmokePaths(plan.playExperienceMode)) {
      const response = await authenticatedFetch(pathname);
      const robots = response.headers.get("x-robots-tag") ?? "";
      if (!response.ok || !robots.includes("noindex") || response.headers.get("cache-control") !== "private, no-store") {
        throw new Error(`Staging smoke failed for ${pathname}.`);
      }
      results.push({ pathname, status: response.status });
    }
    const simulationResponse = await authenticatedFetch("/simulation");
    const expectedSimulationStatus =
      plan.simulation.experienceMode === "campaign-v1" ? 200 : 404;
    if (
      simulationResponse.status !== expectedSimulationStatus ||
      !(simulationResponse.headers.get("x-robots-tag") ?? "").includes(
        "noindex",
      ) ||
      simulationResponse.headers.get("cache-control") !== "private, no-store"
    ) {
      throw new Error("Staging smoke failed for /simulation.");
    }
    results.push({ pathname: "/simulation", status: simulationResponse.status });
    console.log(JSON.stringify({ status: "passed", results }));
  }
}
