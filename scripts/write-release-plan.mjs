import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertActiveActionsWorkflow,
  assertRequiredValidationRuns,
  assertVerifiedActionsRun,
  githubRepositoryFromRemoteUrl,
  publicationCheckpointForPlan,
  REQUIRED_VALIDATION_RUNS,
  simulationReleaseRecord,
} from "./lib/release-contract.mjs";
import { readVerifiedDeployableArtifactManifest } from "./lib/deployable-artifact-contract.mjs";
import {
  RELEASE_BUILD_CHECKPOINT_PATH,
  verifyReleaseBuildCheckpoint,
} from "./lib/release-build-checkpoint.mjs";
import { buildCopyDeck } from "./lib/copy-deck.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to write a release plan.`);
  return value;
}

function git(...arguments_) {
  const result = spawnSync("git", arguments_, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout.trim();
}

function configuredGithubRepository() {
  const branch = git("branch", "--show-current");
  if (!branch) throw new Error("The release commit must be on a named branch.");
  const remote = git("config", "--get", `branch.${branch}.remote`);
  if (!remote || remote === ".") {
    throw new Error("The release branch must track a GitHub remote.");
  }
  return githubRepositoryFromRemoteUrl(git("remote", "get-url", "--push", remote));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function versionId(value, name) {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(value)) {
    throw new Error(`${name} is not a valid Worker version identifier.`);
  }
  return value;
}

function isoDate(value, name) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO timestamp.`);
  }
  return value;
}

const head = git("rev-parse", "HEAD");
if (git("status", "--porcelain=v1", "--untracked-files=all")) {
  throw new Error("A release plan requires a clean worktree.");
}
if (required("RELEASE_VALIDATED_SHA") !== head) {
  throw new Error("RELEASE_VALIDATED_SHA does not match HEAD.");
}
let upstreamSha;
try {
  upstreamSha = git("rev-parse", "@{upstream}");
} catch {
  throw new Error("The release branch must have a configured upstream.");
}
if (upstreamSha !== head) {
  throw new Error("HEAD must be pushed to its configured upstream before release.");
}
const repository = configuredGithubRepository();

const preflight = spawnSync(
  process.execPath,
  [path.join(root, "scripts/release-preflight.mjs")],
  { cwd: root, encoding: "utf8" },
);
if (preflight.error || preflight.status !== 0) {
  throw new Error(
    preflight.stderr?.trim() ||
      preflight.stdout?.trim() ||
      "Release preflight failed before plan creation.",
  );
}

const previousVersionValue = process.env.RELEASE_PREVIOUS_WORKER_VERSION?.trim();
const previousVersion = previousVersionValue
  ? versionId(previousVersionValue, "RELEASE_PREVIOUS_WORKER_VERSION")
  : null;
if (!previousVersion) {
  throw new Error(
    "The hardened release requires the currently deployed Worker version for zero-traffic verification.",
  );
}
const d1Bookmark = required("RELEASE_D1_BOOKMARK");
if (!/^[A-Za-z0-9._~+/=-]{8,512}$/.test(d1Bookmark)) {
  throw new Error("RELEASE_D1_BOOKMARK contains unexpected characters.");
}
const validationEnvironmentNames = new Map([
  ["validate", "RELEASE_VALIDATION_URL"],
  ["gitleaks", "RELEASE_GITLEAKS_URL"],
  ["codeql", "RELEASE_CODEQL_URL"],
  ["browser", "RELEASE_BROWSER_URL"],
]);
const validationRequirements = REQUIRED_VALIDATION_RUNS.map(({
  kind,
  name,
  workflowPath,
}) => ({
  kind,
  name,
  workflowPath,
  env: validationEnvironmentNames.get(kind),
}));
const validationRuns = validationRequirements.map(({
  kind,
  env,
  name,
  workflowPath,
}) => {
  const url = new URL(required(env));
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !/^\/[^/]+\/[^/]+\/actions\/runs\/\d+\/?$/.test(url.pathname)
  ) {
    throw new Error(`${env} must be a GitHub Actions run URL.`);
  }
  const [, repositoryOwner, repositoryName, , , runId] = url.pathname.split("/");
  if (`${repositoryOwner.toLowerCase()}/${repositoryName.toLowerCase()}` !== repository) {
    throw new Error(`${env} must belong to the configured upstream repository.`);
  }
  const result = spawnSync(
    "gh",
    [
      "run",
      "view",
      runId,
      "--repo",
      `${repositoryOwner}/${repositoryName}`,
      "--json",
      "headSha,conclusion,url,name,event,workflowDatabaseId",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`${name} GitHub Actions evidence could not be verified.`);
  }
  let evidence;
  try {
    evidence = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${name} GitHub Actions evidence was unreadable.`);
  }
  assertVerifiedActionsRun(evidence, {
    head,
    url: url.toString(),
    name,
  });
  if (
    !Number.isSafeInteger(evidence.workflowDatabaseId) ||
    evidence.workflowDatabaseId < 1
  ) {
    throw new Error(`${name} evidence has no valid workflow identity.`);
  }
  const workflowResult = spawnSync(
    "gh",
    [
      "api",
      `repos/${repositoryOwner}/${repositoryName}/actions/workflows/${evidence.workflowDatabaseId}`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (workflowResult.error || workflowResult.status !== 0) {
    throw new Error(`${name} workflow identity could not be verified.`);
  }
  let workflow;
  try {
    workflow = JSON.parse(workflowResult.stdout);
  } catch {
    throw new Error(`${name} workflow identity was unreadable.`);
  }
  const workflowIdentity = assertActiveActionsWorkflow(workflow, {
    workflowDatabaseId: evidence.workflowDatabaseId,
    name,
    workflowPath,
  });
  return {
    kind,
    name,
    headSha: evidence.headSha,
    conclusion: evidence.conclusion,
    url: evidence.url,
    event: evidence.event,
    ...workflowIdentity,
  };
});
assertRequiredValidationRuns(validationRuns, head, repository);

const migrationList = (process.env.RELEASE_MIGRATION_LIST ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const availableMigrations = new Set(
  (await readdir(path.join(root, "drizzle"))).filter((name) => name.endsWith(".sql")),
);
if (
  new Set(migrationList).size !== migrationList.length ||
  migrationList.some(
    (name) => !/^\d{4}_[a-z0-9_]+\.sql$/i.test(name) || !availableMigrations.has(name),
  )
) {
  throw new Error("RELEASE_MIGRATION_LIST must name unique checked-in SQL migrations.");
}

const [
  contentAttestationBytes,
  releaseConfigBytes,
  simulationManifestBytes,
  deployableArtifactResult,
  releaseBuildCheckpoint,
  releaseBuildCheckpointBytes,
  ...migrationBytes
] = await Promise.all([
  readFile(path.join(root, "content/public/anish-content.public.v1.attestation.json")),
  readFile(path.join(root, "dist/server/wrangler.public.json")),
  readFile(path.join(root, "content/presentation/simulation.v1.json")),
  readVerifiedDeployableArtifactManifest(root),
  verifyReleaseBuildCheckpoint(root),
  readFile(path.join(root, RELEASE_BUILD_CHECKPOINT_PATH)),
  ...migrationList.map((name) => readFile(path.join(root, "drizzle", name))),
]);
const contentAttestation = JSON.parse(contentAttestationBytes.toString("utf8"));
const releaseConfig = JSON.parse(releaseConfigBytes.toString("utf8"));
const simulationManifest = JSON.parse(simulationManifestBytes.toString("utf8"));
const playExperienceMode = releaseConfig.vars?.PLAY_EXPERIENCE_MODE;
if (
  playExperienceMode !== "classic" &&
  playExperienceMode !== "my-room-2001"
) {
  throw new Error("The prepared hosted Worker config has no explicit supported Play mode.");
}
const publicContent = contentAttestation.artifacts?.find(
  (artifact) => artifact.path === "content/public/anish-content.public.v1.json",
);
if (!publicContent || !/^[a-f0-9]{64}$/.test(publicContent.sha256)) {
  throw new Error("The public-content attestation does not contain a valid bundle hash.");
}
if (
  releaseBuildCheckpoint.artifactSetSha256 !==
    deployableArtifactResult.manifest.artifactSetSha256 ||
  releaseBuildCheckpoint.deployableManifestSha256 !==
    sha256(deployableArtifactResult.bytes)
) {
  throw new Error("The tested release-build checkpoint does not match this deployable artifact set.");
}

const publicationCheckpoint = publicationCheckpointForPlan({
  hash: required("RELEASE_PUBLICATION_HASH"),
  contentVersion: required("RELEASE_PUBLICATION_CONTENT_VERSION"),
  kvPointerMatches: required("RELEASE_PUBLICATION_KV_MATCH") === "1",
  releaseContentVersion: contentAttestation.contentVersion,
  bootstrapPlanned: process.env.RELEASE_PREDEPLOY_BOOTSTRAP === "1",
  previousVersion,
});
const { copyVersion } = await buildCopyDeck(root);
const simulation = simulationReleaseRecord({
  campaignVersion: simulationManifest.campaignVersion,
  experienceMode: releaseConfig.vars?.SIMULATION_EXPERIENCE_MODE,
  aiMode: releaseConfig.vars?.SIMULATION_AI_MODE,
  provider: releaseConfig.vars?.SIMULATION_PROVIDER,
  model: releaseConfig.vars?.SIMULATION_MODEL,
  approvedProviders: process.env.RELEASE_SIMULATION_APPROVED_PROVIDERS,
  approvalStateDigest: process.env.RELEASE_SIMULATION_APPROVAL_DIGEST,
});

const record = {
  schemaVersion: "1.2",
  preparedAt: isoDate(new Date().toISOString(), "preparedAt"),
  commitSha: head,
  repository,
  contentVersion: contentAttestation.contentVersion,
  playExperienceMode,
  copyVersion,
  publicContentSha256: publicContent.sha256,
  deployableArtifacts: {
    artifactSetSha256:
      deployableArtifactResult.manifest.artifactSetSha256,
    fileCount: deployableArtifactResult.manifest.fileCount,
    totalBytes: deployableArtifactResult.manifest.totalBytes,
  },
  releaseBuildCheckpoint: {
    sha256: sha256(releaseBuildCheckpointBytes),
    artifactSetSha256: releaseBuildCheckpoint.artifactSetSha256,
    deployableManifestSha256:
      releaseBuildCheckpoint.deployableManifestSha256,
  },
  publicationCheckpoint,
  simulation,
  validationRuns,
  previousWorkerVersion: previousVersion,
  d1: {
    preMigrationBookmark: d1Bookmark,
    migrations: migrationList.map((name, index) => ({
      name,
      sha256: sha256(migrationBytes[index]),
    })),
  },
  checksums: {
    publicContentAttestationSha256: sha256(contentAttestationBytes),
    preparedWorkerConfigSha256: sha256(releaseConfigBytes),
    simulationCampaignManifestSha256: sha256(simulationManifestBytes),
    deployableArtifactManifestSha256: sha256(
      deployableArtifactResult.bytes,
    ),
    releaseBuildCheckpointSha256: sha256(releaseBuildCheckpointBytes),
  },
};

const outputPath = path.join(root, "dist/release-plan.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
  mode: 0o600,
});
console.log("Wrote ignored dist/release-plan.json. Preserve it through smoke testing.");
