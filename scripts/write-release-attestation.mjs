import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertReleaseMarker,
  assertRequiredValidationRuns,
  assertProductionDeployment,
  githubRepositoryFromRemoteUrl,
  parseRemoteReleaseMarker,
  RELEASE_MARKER_QUERY,
} from "./lib/release-contract.mjs";
import { readVerifiedDeployableArtifactManifest } from "./lib/deployable-artifact-contract.mjs";
import {
  assertTriggerDeploymentReceipt,
  DOMAIN_ACCESS_DESTINATIONS,
  DOMAIN_CUTOVER_SMOKE_TESTS,
  TRIGGER_RECEIPT_PATH,
} from "./lib/release-trigger-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_SMOKE_TESTS = [
  "public_routes",
  "studio_access",
  "non_owner_denial",
  "connector_galleries",
  "oauth_callbacks",
  "security_headers",
  "owner_health",
  ...DOMAIN_CUTOVER_SMOKE_TESTS,
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to write a release attestation.`);
  return value;
}

function git(...arguments_) {
  const result = spawnSync("git", arguments_, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout.trim();
}

function configuredGithubRepository() {
  const branch = git("branch", "--show-current");
  const remote = branch
    ? git("config", "--get", `branch.${branch}.remote`)
    : "";
  if (!remote || remote === ".") {
    throw new Error("The release branch must track a GitHub remote.");
  }
  return githubRepositoryFromRemoteUrl(git("remote", "get-url", "--push", remote));
}

function productionDeployment(version) {
  const wranglerPath = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  const configPath = path.join(root, "dist/server/wrangler.public.json");
  const result = spawnSync(
    process.execPath,
    [
      wranglerPath,
      "deployments",
      "status",
      "--json",
      "--config",
      configPath,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw new Error("The final production Worker deployment could not be verified.");
  }
  return assertProductionDeployment(result.stdout, version);
}

function remoteReleaseMarker() {
  const wranglerPath = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  const configPath = path.join(root, "dist/server/wrangler.public.json");
  const result = spawnSync(
    process.execPath,
    [
      wranglerPath,
      "d1",
      "execute",
      "DB",
      "--remote",
      "--command",
      RELEASE_MARKER_QUERY,
      "--json",
      "--config",
      configPath,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw new Error("The final remote release marker could not be verified.");
  }
  return parseRemoteReleaseMarker(result.stdout);
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
  throw new Error("Commit release records only from a clean worktree.");
}
if (required("RELEASE_VALIDATED_SHA") !== head) {
  throw new Error("RELEASE_VALIDATED_SHA does not match HEAD.");
}

const currentVersion = versionId(
  required("RELEASE_WORKER_VERSION"),
  "RELEASE_WORKER_VERSION",
);
const releasedAt = isoDate(
  process.env.RELEASED_AT?.trim() || new Date().toISOString(),
  "RELEASED_AT",
);
const smokeTestedAt = isoDate(
  required("RELEASE_SMOKE_TESTED_AT"),
  "RELEASE_SMOKE_TESTED_AT",
);
const smokeResults = required("RELEASE_SMOKE_RESULTS")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (
  smokeResults.length !== REQUIRED_SMOKE_TESTS.length ||
  REQUIRED_SMOKE_TESTS.some((name) => !smokeResults.includes(name)) ||
  new Set(smokeResults).size !== smokeResults.length
) {
  throw new Error(
    `RELEASE_SMOKE_RESULTS must contain exactly: ${REQUIRED_SMOKE_TESTS.join(",")}`,
  );
}

const [
  planBytes,
  contentAttestationBytes,
  releaseConfigBytes,
  deployableArtifactResult,
  triggerReceiptBytes,
] = await Promise.all([
  readFile(path.join(root, "dist/release-plan.json")),
  readFile(path.join(root, "content/public/anish-content.public.v1.attestation.json")),
  readFile(path.join(root, "dist/server/wrangler.public.json")),
  readVerifiedDeployableArtifactManifest(root),
  readFile(path.join(root, TRIGGER_RECEIPT_PATH)),
]);
const plan = JSON.parse(planBytes.toString("utf8"));
const contentAttestation = JSON.parse(contentAttestationBytes.toString("utf8"));
const releaseConfig = JSON.parse(releaseConfigBytes.toString("utf8"));
const triggerReceipt = JSON.parse(triggerReceiptBytes.toString("utf8"));
if (
  plan.schemaVersion !== "1.0" ||
  plan.commitSha !== head ||
  plan.contentVersion !== contentAttestation.contentVersion ||
  !["compatible", "predeploy_bootstrap_required"].includes(
    plan.publicationCheckpoint?.status,
  ) ||
  plan.checksums?.publicContentAttestationSha256 !== sha256(contentAttestationBytes) ||
  plan.checksums?.preparedWorkerConfigSha256 !== sha256(releaseConfigBytes) ||
  plan.checksums?.deployableArtifactManifestSha256 !==
    sha256(deployableArtifactResult.bytes) ||
  plan.deployableArtifacts?.artifactSetSha256 !==
    deployableArtifactResult.manifest.artifactSetSha256 ||
  plan.deployableArtifacts?.fileCount !==
    deployableArtifactResult.manifest.fileCount ||
  plan.deployableArtifacts?.totalBytes !==
    deployableArtifactResult.manifest.totalBytes
) {
  throw new Error("The pre-release plan is missing, stale, or does not match this build.");
}
const verifiedTriggerReceipt = assertTriggerDeploymentReceipt(triggerReceipt, {
  head,
  configSha256: sha256(releaseConfigBytes),
  config: releaseConfig,
  notBefore: plan.preparedAt,
});
const repository = configuredGithubRepository();
if (plan.repository !== repository) {
  throw new Error("The release plan does not match the configured upstream repository.");
}
assertRequiredValidationRuns(plan.validationRuns, head, repository);
if (
  !Array.isArray(plan.d1?.migrations) ||
  plan.d1.migrations.some(
    (migration) =>
      !migration ||
      typeof migration.name !== "string" ||
      !/^[a-f0-9]{64}$/.test(migration.sha256),
  )
) {
  throw new Error("The pre-release plan has invalid migration evidence.");
}
const currentMigrationBytes = await Promise.all(
  plan.d1.migrations.map((migration) =>
    readFile(path.join(root, "drizzle", migration.name)),
  ),
);
if (
  currentMigrationBytes.some(
    (bytes, index) => sha256(bytes) !== plan.d1.migrations[index].sha256,
  )
) {
  throw new Error("A migration changed after the pre-release plan was written.");
}
if (Date.parse(smokeTestedAt) < Date.parse(plan.preparedAt)) {
  throw new Error("Production smoke testing cannot predate the release plan.");
}
if (Date.parse(releasedAt) < Date.parse(smokeTestedAt)) {
  throw new Error("The release timestamp cannot predate production smoke testing.");
}
if (plan.previousWorkerVersion === currentVersion) {
  throw new Error("The deployed Worker version must differ from the prior version.");
}
const finalPublication = remoteReleaseMarker();
assertReleaseMarker(finalPublication, {
  head,
  contentVersion: plan.contentVersion,
  preparedAt: plan.preparedAt,
});
const finalDeployment = productionDeployment(currentVersion);

const record = {
  schemaVersion: "1.2",
  releasedAt,
  smokeTestedAt,
  commitSha: head,
  contentVersion: plan.contentVersion,
  publicContentSha256: plan.publicContentSha256,
  deployableArtifacts: plan.deployableArtifacts,
  publicationCheckpoint: plan.publicationCheckpoint,
  releasePublication: {
    status: finalPublication.status,
    releaseSha: finalPublication.details.releaseSha,
    contentVersion: finalPublication.details.contentVersion,
    contentHash: finalPublication.details.contentHash,
    verifiedAt: finalPublication.checkedAt,
  },
  validationRuns: plan.validationRuns,
  worker: {
    name: "anish-shah-work-in-public",
    previousVersion: plan.previousWorkerVersion,
    currentVersion,
    deploymentId: finalDeployment.deploymentId,
    trafficPercentage: finalDeployment.percentage,
  },
  nonVersionedTriggers: verifiedTriggerReceipt,
  domainCutover: {
    canonicalOrigin: verifiedTriggerReceipt.settings.canonicalOrigin,
    wwwRedirect: "permanent_path_query_preserving",
    workersDev: "disabled",
    previewUrls: "disabled",
    requestIdHeader: "x-request-id",
    accessDestinations: [...DOMAIN_ACCESS_DESTINATIONS],
    verifiedBySmokeTests: [...DOMAIN_CUTOVER_SMOKE_TESTS],
  },
  d1: plan.d1,
  smokeTests: REQUIRED_SMOKE_TESTS.map((id) => ({ id, status: "pass" })),
  checksums: {
    ...plan.checksums,
    releasePlanSha256: sha256(planBytes),
    triggerDeploymentReceiptSha256: sha256(triggerReceiptBytes),
  },
};

const directory = path.join(root, "releases");
await mkdir(directory, { recursive: true });
const filename = `${releasedAt.slice(0, 10)}-${head.slice(0, 12)}.json`;
const outputPath = path.join(directory, filename);
await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o644,
});
console.log(`Wrote ${path.relative(root, outputPath)}. Review and commit it.`);
