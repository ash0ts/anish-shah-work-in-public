import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertRequiredValidationRuns,
  assertVerifiedActionsRun,
  exactMigrationNames,
  exactVersionIds,
  githubRepositoryFromRemoteUrl,
  requireExactUploadedVersion,
  runGuardedMigration,
} from "./lib/release-contract.mjs";
import {
  assertStagingConfiguration,
  expectedStagingCoordinates,
  STAGING_SITE_ORIGIN,
  STAGING_WORKER_NAME,
} from "./lib/hosted-config-contract.mjs";
import { readVerifiedDeployableArtifactManifest } from "./lib/deployable-artifact-contract.mjs";

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
  const [configBytes, bundleBytes, artifactResult] = await Promise.all([
    readFile(configPath),
    readFile(path.join(root, "content/public/anish-content.public.v1.json")),
    readVerifiedDeployableArtifactManifest(root),
  ]);
  const config = JSON.parse(configBytes);
  const bundle = JSON.parse(bundleBytes);
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
  return { config, configBytes, bundle, artifactResult };
}

function verifiedRuns(head, configuredRepository) {
  return [
    ["validate", "STAGING_VALIDATION_URL", "Validate"],
    ["gitleaks", "STAGING_GITLEAKS_URL", "Gitleaks"],
    ["codeql", "STAGING_CODEQL_URL", "CodeQL"],
  ].map(([kind, environmentName, name]) => {
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
      "--json", "headSha,conclusion,url,name",
    ]);
    const evidence = JSON.parse(result);
    assertVerifiedActionsRun(evidence, { head, url: url.toString(), name });
    return { kind, name, ...evidence };
  });
}

async function writePlan() {
  const head = verifyGitState();
  const { configBytes, bundle, artifactResult } = await configState(head);
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
  const plan = {
    schemaVersion: "1.0",
    deploymentTier: "staging",
    preparedAt: new Date().toISOString(),
    commitSha: head,
    repository: configuredRepository,
    workerName: STAGING_WORKER_NAME,
    siteUrl: STAGING_SITE_ORIGIN,
    contentVersion: bundle.contentVersion,
    previousWorkerVersion,
    d1: { preMigrationBookmark: bookmark, migrations },
    validationRuns,
    checksums: {
      preparedWorkerConfigSha256: sha256(configBytes),
      deployableArtifactManifestSha256: sha256(artifactResult.bytes),
      deployableArtifactSetSha256: artifactResult.manifest.artifactSetSha256,
    },
  };
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  console.log("Wrote ignored dist/staging-release-plan.json.");
}

async function verifyPlan() {
  const head = verifyGitState();
  const { configBytes, bundle, artifactResult } = await configState(head);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  if (
    plan.schemaVersion !== "1.0" ||
    plan.deploymentTier !== "staging" ||
    plan.commitSha !== head ||
    plan.repository !== repository() ||
    plan.workerName !== STAGING_WORKER_NAME ||
    plan.siteUrl !== STAGING_SITE_ORIGIN ||
    plan.contentVersion !== bundle.contentVersion ||
    plan.checksums?.preparedWorkerConfigSha256 !== sha256(configBytes) ||
    plan.checksums?.deployableArtifactManifestSha256 !== sha256(artifactResult.bytes) ||
    plan.checksums?.deployableArtifactSetSha256 !== artifactResult.manifest.artifactSetSha256
  ) {
    throw new Error("The staging release plan is stale or crossed an environment boundary.");
  }
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

async function authenticatedFetch(pathname, init = {}) {
  const jwt = required("STAGING_ACCESS_JWT");
  if (jwt.length > 16_384 || /\s/.test(jwt)) throw new Error("STAGING_ACCESS_JWT is malformed.");
  return fetch(new URL(pathname, STAGING_SITE_ORIGIN), {
    ...init,
    redirect: "manual",
    headers: {
      ...init.headers,
      cookie: `CF_Authorization=${jwt}`,
      origin: STAGING_SITE_ORIGIN,
    },
  });
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
    const before = await authenticatedFetch("/api/studio/publication-checkpoint");
    const existing = await before.json().catch(() => null);
    if (
      before.ok &&
      existing?.status === "ready" &&
      existing?.contentVersion === plan.contentVersion &&
      existing?.kvPointerMatches === true
    ) {
      console.log(JSON.stringify({ status: "already_ready", contentVersion: existing.contentVersion }));
    } else {
      const published = await authenticatedFetch("/api/studio/publish", { method: "POST" });
      const publication = await published.json().catch(() => null);
      if (!published.ok || publication?.publication?.recordCount < 1) {
        throw new Error("Staging publication bootstrap failed.");
      }
      const confirmed = await authenticatedFetch("/api/studio/publication-checkpoint");
      const checkpoint = await confirmed.json().catch(() => null);
      if (
        !confirmed.ok ||
        checkpoint?.status !== "ready" ||
        checkpoint?.contentVersion !== plan.contentVersion ||
        checkpoint?.kvPointerMatches !== true
      ) {
        throw new Error("Staging D1/KV publication did not reconcile after bootstrap.");
      }
      console.log(JSON.stringify({
        status: "published",
        recordCount: publication.publication.recordCount,
        contentVersion: checkpoint.contentVersion,
      }));
    }
  } else if (action === "checkpoint") {
    const response = await authenticatedFetch("/api/studio/health");
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.releaseSha !== head || body?.contentVersion !== plan.contentVersion) {
      throw new Error("Staging health does not match the planned SHA and content version.");
    }
    const publicationResponse = await authenticatedFetch("/api/studio/publication-checkpoint");
    const publication = await publicationResponse.json().catch(() => null);
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
    }));
  } else if (action === "smoke") {
    const results = [];
    for (const pathname of ["/", "/work", "/play", "/sources", "/privacy", "/robots.txt"]) {
      const response = await authenticatedFetch(pathname);
      const robots = response.headers.get("x-robots-tag") ?? "";
      if (!response.ok || !robots.includes("noindex") || response.headers.get("cache-control") !== "private, no-store") {
        throw new Error(`Staging smoke failed for ${pathname}.`);
      }
      results.push({ pathname, status: response.status });
    }
    console.log(JSON.stringify({ status: "passed", results }));
  }
}
