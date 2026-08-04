import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertActiveActionsWorkflow,
  assertReleaseMarker,
  assertRequiredValidationRuns,
  assertSimulationReleaseRecord,
  assertVerifiedActionsRun,
  exactMigrationNames,
  exactVersionIds,
  githubRepositoryFromRemoteUrl,
  parseRemoteReleaseMarker,
  RELEASE_MARKER_QUERY,
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
import {
  assertStagingDeployment,
  assertStagingCandidateHealth,
  assertStagingCheckpointReceipt,
  assertFreshStagingPromotionCheckpoint,
  assertStagingPublication,
  assertStagingTriggerReceipt,
  createStagingCheckpointReceipt,
  createStagingTriggerReceipt,
  stagingActionRequiresCleanMigrations,
  waitForStagingDeploymentState,
  STAGING_CHECKPOINT_RECEIPT_PATH,
  STAGING_TRIGGER_RECEIPT_PATH,
} from "./lib/staging-release-state.mjs";
import { buildCopyDeck } from "./lib/copy-deck.mjs";
import {
  assertReleaseBranch,
  readPackageReleaseVersion,
} from "./lib/release-version.mjs";

const root = process.cwd();
const configPath = path.join(root, "dist/server/wrangler.staging.json");
const planPath = path.join(root, "dist/staging-release-plan.json");
const wranglerPath = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const action = process.argv[2];
const supported = new Set([
  "plan", "migrate", "upload", "stage", "bootstrap", "checkpoint", "deploy", "smoke", "rollback",
]);
if (!supported.has(action)) {
  throw new Error("Use staging-release.mjs plan, migrate, upload, stage, bootstrap, checkpoint, deploy, smoke, or rollback.");
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
  const { stdoutOnly = false, ...spawnOptions } = options;
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...spawnOptions,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} ${arguments_.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return stdoutOnly
    ? `${result.stdout ?? ""}`
    : `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function git(...arguments_) {
  return run("git", arguments_).trim();
}

function wrangler(...arguments_) {
  return run(process.execPath, [wranglerPath, ...arguments_]);
}

function wranglerJson(...arguments_) {
  return run(process.execPath, [wranglerPath, ...arguments_], {
    stdoutOnly: true,
  });
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
  const branch = git("branch", "--show-current");
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
  return { branch, head };
}

async function configState(head) {
  const [configBytes, bundleBytes, simulationManifestBytes, artifactResult, releaseVersion] = await Promise.all([
    readFile(configPath),
    readFile(path.join(root, "content/public/anish-content.public.v1.json")),
    readFile(path.join(root, "content/presentation/simulation.v1.json")),
    readVerifiedDeployableArtifactManifest(root),
    readPackageReleaseVersion(root),
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
    releaseVersion,
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
    releaseVersion,
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
  const { branch, head } = verifyGitState();
  const {
    config,
    configBytes,
    bundle,
    simulationManifest,
    simulationManifestBytes,
    artifactResult,
    releaseVersion,
  } = await configState(head);
  assertReleaseBranch(branch, releaseVersion);
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
    schemaVersion: "1.3",
    deploymentTier: "staging",
    preparedAt: new Date().toISOString(),
    commitSha: head,
    repository: configuredRepository,
    workerName: STAGING_WORKER_NAME,
    siteUrl: STAGING_SITE_ORIGIN,
    releaseVersion,
    contentVersion: bundle.contentVersion,
    travelAtlasMode: config.vars.TRAVEL_ATLAS_MODE,
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
  const { branch, head } = verifyGitState();
  const {
    config,
    configBytes,
    bundle,
    simulationManifest,
    simulationManifestBytes,
    artifactResult,
    releaseVersion,
  } = await configState(head);
  assertReleaseBranch(branch, releaseVersion);
  const [planBytes, releaseBuildCheckpoint, releaseBuildCheckpointBytes] =
    await Promise.all([
      readFile(planPath),
      verifyReleaseBuildCheckpoint(root),
      readFile(path.join(root, RELEASE_BUILD_CHECKPOINT_PATH)),
    ]);
  const plan = JSON.parse(planBytes.toString("utf8"));
  const { copyVersion } = await buildCopyDeck(root);
  if (
    plan.schemaVersion !== "1.3" ||
    plan.deploymentTier !== "staging" ||
    plan.commitSha !== head ||
    plan.repository !== repository() ||
    plan.workerName !== STAGING_WORKER_NAME ||
    plan.siteUrl !== STAGING_SITE_ORIGIN ||
    plan.releaseVersion !== releaseVersion ||
    config.vars?.RELEASE_VERSION !== releaseVersion ||
    plan.contentVersion !== bundle.contentVersion ||
    plan.travelAtlasMode !== config.vars?.TRAVEL_ATLAS_MODE ||
    !new Set(["disabled", "atlas-v1"]).has(plan.travelAtlasMode) ||
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
  return {
    head,
    plan,
    planSha256: sha256(planBytes),
    config,
    configBytes,
  };
}

async function pendingMigrations() {
  return exactMigrationNames(
    wrangler("d1", "migrations", "list", "DB", "--remote", "--config", configPath),
  );
}

async function requireNoPendingMigrations(operation) {
  const pending = await pendingMigrations();
  if (pending.length) {
    throw new Error(
      `Apply staging migrations before ${operation}: ${pending.join(", ")}.`,
    );
  }
}

async function readReceipt(relativePath, missingMessage) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
  } catch {
    throw new Error(missingMessage);
  }
}

async function requireStagingTriggerReceipt({
  head,
  plan,
  configBytes,
}) {
  const receipt = await readReceipt(
    STAGING_TRIGGER_RECEIPT_PATH,
    "Run npm run staging:stage before checkpointing or promoting this candidate.",
  );
  return assertStagingTriggerReceipt(receipt, {
    head,
    configSha256: sha256(configBytes),
    notBefore: plan.preparedAt,
  });
}

function stagingWorkerVersion(plan, { allowPrevious = false } = {}) {
  const version = required("STAGING_WORKER_VERSION");
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(version)) {
    throw new Error("STAGING_WORKER_VERSION must be the uploaded staging Worker version ID.");
  }
  if (!allowPrevious && version === plan.previousWorkerVersion) {
    throw new Error("The staging candidate equals the prior staging version.");
  }
  return version;
}

function candidateVersionOverride(plan) {
  return `${STAGING_WORKER_NAME}="${stagingWorkerVersion(plan)}"`;
}

function remoteReleaseMarker() {
  return parseRemoteReleaseMarker(
    wranglerJson(
      "d1",
      "execute",
      "DB",
      "--remote",
      "--command",
      RELEASE_MARKER_QUERY,
      "--json",
      "--config",
      configPath,
    ),
  );
}

function currentStagingDeployment() {
  let deployment;
  try {
    deployment = JSON.parse(
      wranglerJson(
        "deployments",
        "status",
        "--config",
        configPath,
        "--json",
      ),
    );
  } catch {
    throw new Error("The current staging Worker deployment could not be read.");
  }
  return deployment;
}

function requireStagedCandidate(plan) {
  const deployment = currentStagingDeployment();
  return {
    deployment,
    state: assertStagingDeployment(deployment, {
      candidateVersion: stagingWorkerVersion(plan),
      priorVersion: plan.previousWorkerVersion,
      phase: "staged",
    }),
  };
}

async function waitForStagingDeployment(
  plan,
  { phase, candidateVersion = stagingWorkerVersion(plan) },
) {
  return waitForStagingDeploymentState({
    readDeployment: async () => currentStagingDeployment(),
    waitForReadiness: waitForReadOnlyStagingReadiness,
    candidateVersion,
    priorVersion: phase === "staged" ? plan.previousWorkerVersion : null,
    phase,
  });
}

async function authenticatedFetch(
  pathname,
  init = {},
  consumeResponse = (response) => response,
) {
  const jwt = required("STAGING_ACCESS_JWT");
  if (jwt.length > 16_384 || /\s/.test(jwt)) throw new Error("STAGING_ACCESS_JWT is malformed.");
  const { timeoutMs, candidatePlan, ...requestInit } = init;
  const versionHeaders = candidatePlan
    ? {
        "Cloudflare-Workers-Version-Overrides":
          candidateVersionOverride(candidatePlan),
      }
    : {};
  return fetchWithTimeout(
    fetch,
    new URL(pathname, STAGING_SITE_ORIGIN),
    {
      ...requestInit,
      redirect: "manual",
      headers: {
        ...versionHeaders,
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

async function waitForCandidateReadiness(
  head,
  contentVersion,
  releaseVersion,
  copyVersion,
  candidatePlan = null,
) {
  return waitForReadOnlyStagingReadiness({
    check: async (timeoutMs) => {
      const { response, body } = await authenticatedJson("/api/studio/health", {
        method: "GET",
        timeoutMs,
        candidatePlan,
      });
      if (!response.ok) return false;
      return body?.releaseSha === head &&
        body?.releaseVersion === releaseVersion &&
        body?.contentVersion === contentVersion &&
        body?.copyVersion === copyVersion;
    },
  });
}

async function waitForPublicationReadiness(contentVersion, candidatePlan = null) {
  let checkpoint = null;
  await waitForReadOnlyStagingReadiness({
    check: async (timeoutMs) => {
      const { response, body } = await authenticatedJson(
        "/api/studio/publication-checkpoint",
        { method: "GET", timeoutMs, candidatePlan },
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

async function readAndAssertCandidateState({ head, plan }) {
  await waitForCandidateReadiness(
    head,
    plan.contentVersion,
    plan.releaseVersion,
    plan.copyVersion,
    plan,
  );
  const [{ response: healthResponse, body: health }, publication] =
    await Promise.all([
      authenticatedJson("/api/studio/health", { candidatePlan: plan }),
      waitForPublicationReadiness(plan.contentVersion, plan),
    ]);
  if (!healthResponse.ok) {
    throw new Error("The staging candidate health endpoint is unavailable.");
  }
  assertStagingCandidateHealth(health, { head, plan });
  assertStagingPublication(publication, plan);
  return { health, publication };
}

if (action === "plan") {
  await writePlan();
} else {
  const { head, plan, planSha256, configBytes } = await verifyPlan();
  if (stagingActionRequiresCleanMigrations(action)) {
    await requireNoPendingMigrations(action);
  }
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
  } else if (action === "stage" || action === "rollback") {
    const requested = action === "rollback"
      ? plan.previousWorkerVersion
      : stagingWorkerVersion(plan);
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(requested)) throw new Error("The staging Worker version is invalid.");
    const available = exactVersionIds(wrangler("versions", "list", "--config", configPath));
    requireExactUploadedVersion(available.join("\n"), requested);
    if (action === "stage") {
      if (!available.includes(plan.previousWorkerVersion)) {
        throw new Error("The prior staging Worker version is unavailable for zero-traffic staging.");
      }
      process.stdout.write(wrangler("triggers", "deploy", "--config", configPath));
      const triggerReceipt = createStagingTriggerReceipt({
        head,
        configSha256: sha256(configBytes),
        appliedAt: new Date().toISOString(),
      });
      await writeFile(
        path.join(root, STAGING_TRIGGER_RECEIPT_PATH),
        `${JSON.stringify(triggerReceipt, null, 2)}\n`,
        { mode: 0o600 },
      );
      process.stdout.write(wrangler(
        "versions",
        "deploy",
        `${requested}@0%`,
        `${plan.previousWorkerVersion}@100%`,
        "--config",
        configPath,
        "--yes",
      ));
      await waitForStagingDeployment(plan, { phase: "staged" });
    } else {
      process.stdout.write(wrangler("versions", "deploy", `${requested}@100%`, "--config", configPath, "--yes"));
      await waitForStagingDeployment(plan, {
        phase: "deployed",
        candidateVersion: requested,
      });
    }
  } else if (action === "bootstrap") {
    await requireStagingTriggerReceipt({ head, plan, configBytes });
    requireStagedCandidate(plan);
    await waitForCandidateReadiness(
      head,
      plan.contentVersion,
      plan.releaseVersion,
      plan.copyVersion,
      plan,
    );
    const { response: maintenanceResponse, body: maintenance } =
      await authenticatedJson("/api/studio/maintenance/bootstrap", {
        method: "POST",
        candidatePlan: plan,
      });
    if (
      !maintenanceResponse.ok ||
      maintenance?.status !== "complete" ||
      !Number.isFinite(Date.parse(maintenance?.checkedAt ?? ""))
    ) {
      throw new Error(
        "The 0%-traffic staging candidate could not initialize retention maintenance.",
      );
    }
    const { response: before, body: existing } = await authenticatedJson(
      "/api/studio/publication-checkpoint",
      { candidatePlan: plan },
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
        { method: "POST", candidatePlan: plan },
      );
      if (!published.ok || publication?.publication?.recordCount < 1) {
        throw new Error("Staging publication bootstrap failed.");
      }
      const checkpoint = await waitForPublicationReadiness(
        plan.contentVersion,
        plan,
      );
      console.log(JSON.stringify({
        status: "published",
        recordCount: publication.publication.recordCount,
        contentVersion: checkpoint.contentVersion,
      }));
    }
  } else if (action === "checkpoint") {
    await requireStagingTriggerReceipt({ head, plan, configBytes });
    const { health, publication } = await readAndAssertCandidateState({
      head,
      plan,
    });
    const simulation = health.simulation;
    const travel = health.travel;
    const { response: releaseResponse, body: releaseCheckpoint } =
      await authenticatedJson("/api/studio/release-checkpoint", {
        method: "POST",
        candidatePlan: plan,
      });
    if (
      !releaseResponse.ok ||
      releaseCheckpoint?.checkpoint?.releaseSha !== head ||
      releaseCheckpoint?.checkpoint?.releaseVersion !== plan.releaseVersion ||
      releaseCheckpoint?.checkpoint?.contentVersion !== plan.contentVersion ||
      releaseCheckpoint?.checkpoint?.contentHash !== publication.contentHash
    ) {
      throw new Error(
        "The protected staging release checkpoint did not bind the candidate and publication.",
      );
    }
    const { deployment } = requireStagedCandidate(plan);
    const checkpointReceipt = createStagingCheckpointReceipt({
      head,
      workerVersion: stagingWorkerVersion(plan),
      planSha256,
      plan,
      health,
      publication,
      deployment,
      checkedAt: new Date().toISOString(),
    });
    await writeFile(
      path.join(root, STAGING_CHECKPOINT_RECEIPT_PATH),
      `${JSON.stringify(checkpointReceipt, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log(JSON.stringify({
      status: "ready",
      releaseSha: health.releaseSha,
      releaseVersion: health.releaseVersion,
      contentVersion: health.contentVersion,
      copyVersion: health.copyVersion,
      kvPointerMatches: true,
      travel: plan.travelAtlasMode === "atlas-v1"
        ? {
            configured: travel.configured,
            contentHash: travel.activePublication.contentHash,
            counts: travel.activePublication.counts,
            cleanupHeartbeat: travel.cleanupHeartbeat.status,
          }
        : { configured: false },
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
  } else if (action === "deploy") {
    await requireStagingTriggerReceipt({ head, plan, configBytes });
    const workerVersion = stagingWorkerVersion(plan);
    const available = exactVersionIds(
      wrangler("versions", "list", "--config", configPath),
    );
    requireExactUploadedVersion(available.join("\n"), workerVersion);
    requireStagedCandidate(plan);
    const { health, publication } = await readAndAssertCandidateState({
      head,
      plan,
    });
    const checkpointReceipt = await readReceipt(
      STAGING_CHECKPOINT_RECEIPT_PATH,
      "Run npm run staging:checkpoint before promoting this candidate.",
    );
    const { deployment: checkpointedDeployment } = requireStagedCandidate(plan);
    assertStagingCheckpointReceipt(checkpointReceipt, {
      head,
      workerVersion,
      planSha256,
      plan,
      health,
      publication,
      deployment: checkpointedDeployment,
      notBefore: plan.preparedAt,
    });
    assertReleaseMarker(remoteReleaseMarker(), {
      head,
      releaseVersion: plan.releaseVersion,
      contentVersion: plan.contentVersion,
      preparedAt: plan.preparedAt,
    });
    await assertFreshStagingPromotionCheckpoint({
      readDeployment: async () => requireStagedCandidate(plan).deployment,
      readCandidateState: async () =>
        readAndAssertCandidateState({ head, plan }),
      checkpointReceipt,
      expected: {
        head,
        workerVersion,
        planSha256,
        plan,
        notBefore: plan.preparedAt,
      },
    });
    process.stdout.write(
      wrangler(
        "versions",
        "deploy",
        `${workerVersion}@100%`,
        "--config",
        configPath,
        "--yes",
      ),
    );
    await waitForStagingDeployment(plan, {
      phase: "deployed",
      candidateVersion: workerVersion,
    });
  } else if (action === "smoke") {
    await waitForStagingDeployment(plan, { phase: "deployed" });
    await waitForCandidateReadiness(
      head,
      plan.contentVersion,
      plan.releaseVersion,
      plan.copyVersion,
    );
    const results = [];
    for (const pathname of stagingSmokePaths({
      travelEnabled: plan.travelAtlasMode === "atlas-v1",
    })) {
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
