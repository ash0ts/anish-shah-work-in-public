import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RELEASE_BUILD_CHECKPOINT_PATH,
  verifyReleaseBuildCheckpoint,
} from "./lib/release-build-checkpoint.mjs";
import {
  assertOwnerLocalTrustedSource,
  assertReleaseValidationEvidence,
  githubRepositoryFromRemoteUrl,
  readOwnerLocalEvidenceReceipt,
  RELEASE_EVIDENCE_MODES,
  releaseTravelHealthMatches,
} from "./lib/release-contract.mjs";
import { reverifyPlannedOwnerLocalCodeqlEvidence } from "./lib/owner-local-codeql.mjs";
import { verifyOwnerLocalRemoteMain } from "./lib/owner-local-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [plan, releaseBuildCheckpoint, releaseBuildCheckpointBytes] =
  await Promise.all([
    readFile(path.join(root, "dist/release-plan.json"), "utf8").then(JSON.parse),
    verifyReleaseBuildCheckpoint(root),
    readFile(path.join(root, RELEASE_BUILD_CHECKPOINT_PATH)),
  ]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function git(...arguments_) {
  const result = spawnSync("git", arguments_, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${arguments_.join(" ")} could not be verified.`);
  }
  return result.stdout.trim();
}
if (
  plan.schemaVersion !== "1.4" ||
  !plan.simulation ||
  !["disabled", "atlas-v1"].includes(plan.travelAtlasMode) ||
  plan.releaseBuildCheckpoint?.sha256 !==
    sha256(releaseBuildCheckpointBytes) ||
  plan.releaseBuildCheckpoint?.artifactSetSha256 !==
    releaseBuildCheckpoint.artifactSetSha256 ||
  plan.releaseBuildCheckpoint?.deployableManifestSha256 !==
    releaseBuildCheckpoint.deployableManifestSha256
) {
  throw new Error(
    "The release-build checkpoint is missing, stale, or does not match the planned candidate.",
  );
}
let localReceipt;
let localReceiptBytes;
if (plan.validationEvidence?.mode === RELEASE_EVIDENCE_MODES.ownerLocal) {
  const head = git("rev-parse", "HEAD");
  assertOwnerLocalTrustedSource({
    head,
    branch: git("branch", "--show-current"),
    upstreamRef: git(
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ),
    upstreamSha: git("rev-parse", "@{upstream}"),
    repository: githubRepositoryFromRemoteUrl(
      git("remote", "get-url", "--push", "origin"),
    ),
    worktreeStatus: git("status", "--porcelain=v1", "--untracked-files=all"),
  });
  verifyOwnerLocalRemoteMain({ root, head });
  if (head !== plan.commitSha) {
    throw new Error("The release checkpoint no longer matches origin/main.");
  }
  ({ receipt: localReceipt, receiptBytes: localReceiptBytes } =
    await readOwnerLocalEvidenceReceipt(root));
  reverifyPlannedOwnerLocalCodeqlEvidence({
    root,
    head,
    repository: plan.repository,
    validationRuns: plan.validationRuns,
  });
}
const commitTimeResult = spawnSync(
  "git",
  ["show", "-s", "--format=%cI", plan.commitSha],
  { cwd: root, encoding: "utf8" },
);
if (commitTimeResult.error || commitTimeResult.status !== 0) {
  throw new Error("The planned release commit timestamp could not be verified.");
}
assertReleaseValidationEvidence(
  plan.validationEvidence,
  plan.validationRuns,
  {
    head: plan.commitSha,
    repository: plan.repository,
    ref: plan.sourceRef,
    artifact: {
      artifactSetSha256: releaseBuildCheckpoint.artifactSetSha256,
      deployableManifestSha256:
        releaseBuildCheckpoint.deployableManifestSha256,
      releaseBuildCheckpointSha256: sha256(releaseBuildCheckpointBytes),
    },
    notBefore: new Date(commitTimeResult.stdout.trim()).toISOString(),
    notAfter: plan.preparedAt,
    localReceipt,
    localReceiptBytes,
  },
);
const version = process.env.RELEASE_WORKER_VERSION?.trim();
if (!version || !/^[0-9a-f-]{36}$/i.test(version)) {
  throw new Error("RELEASE_WORKER_VERSION must be the staged Worker version ID.");
}
if (
  !["compatible", "predeploy_bootstrap_required"].includes(
    plan.publicationCheckpoint?.status,
  )
) {
  throw new Error("The release plan has no valid publication checkpoint status.");
}

const override = `anish-shah-work-in-public="${version}"`;
const script = `(async () => {
  const headers = {"Cloudflare-Workers-Version-Overrides": ${JSON.stringify(override)}};
  const readJson = async (path, init = {}) => {
    const response = await fetch(path, {credentials: "same-origin", ...init, headers: {...headers, ...(init.headers || {})}});
    const body = await response.json().catch(() => null);
    const code = body && typeof body === "object" && typeof body.code === "string" && /^[a-z0-9_]{1,64}$/.test(body.code) ? " (" + body.code + ")" : "";
    if (!response.ok) throw new Error(path + " failed with " + response.status + code);
    return body;
  };
  const health = await readJson("/api/studio/health");
  if (health.status !== "healthy") throw new Error("The staged Worker health check is not healthy.");
  if (health.releaseSha !== ${JSON.stringify(plan.commitSha)}) throw new Error("Version override did not reach the validated Worker.");
  if (health.releaseVersion !== ${JSON.stringify(plan.releaseVersion)}) throw new Error("Version override did not expose the planned release version.");
  const simulation = health.simulation;
  const campaignEnabled = ${JSON.stringify(plan.simulation.experienceMode === "campaign-v1")};
  const approvalMismatch = campaignEnabled && (simulation?.providerApprovalDigest !== ${JSON.stringify(plan.simulation.approvalStateDigest)} || JSON.stringify(simulation?.approvedProviders) !== ${JSON.stringify(JSON.stringify(plan.simulation.approvedProviders))});
  if (!simulation || simulation.campaignVersion !== ${JSON.stringify(plan.simulation.campaignVersion)} || simulation.experienceMode !== ${JSON.stringify(plan.simulation.experienceMode)} || simulation.aiMode !== ${JSON.stringify(plan.simulation.aiMode)} || simulation.provider !== ${JSON.stringify(plan.simulation.provider)} || simulation.model !== ${JSON.stringify(plan.simulation.model)} || approvalMismatch || (campaignEnabled && simulation.configured !== true)) {
    throw new Error("The staged simulation configuration or provider-approval state does not match the release plan.");
  }
  const travel = health.travel;
  const releaseTravelHealthMatches = ${releaseTravelHealthMatches.toString()};
  if (!releaseTravelHealthMatches(travel, ${JSON.stringify(plan.travelAtlasMode)})) {
    throw new Error("The staged Travel configuration, publication, trip count, or cleanup state does not match the release plan.");
  }
  const bootstrapRequired = ${JSON.stringify(plan.publicationCheckpoint.status === "predeploy_bootstrap_required")};
  const published = bootstrapRequired ? await readJson("/api/studio/publish", {method: "POST"}) : null;
  const checkpoint = await readJson("/api/studio/publication-checkpoint");
  if (checkpoint.status !== "ready" || checkpoint.contentVersion !== ${JSON.stringify(plan.contentVersion)} || checkpoint.kvPointerMatches !== true) {
    throw new Error("D1/KV publication checkpoint did not reconcile.");
  }
  const confirmed = await readJson("/api/studio/release-checkpoint", {method: "POST"});
  if (confirmed.checkpoint?.releaseSha !== ${JSON.stringify(plan.commitSha)} || confirmed.checkpoint?.releaseVersion !== ${JSON.stringify(plan.releaseVersion)} || confirmed.checkpoint?.contentVersion !== ${JSON.stringify(plan.contentVersion)} || confirmed.checkpoint?.contentHash !== checkpoint.contentHash) {
    throw new Error("The protected release checkpoint did not bind the staged Worker and active publication.");
  }
  console.log({publishedRecords: published?.publication?.recordCount ?? null, releaseSha: confirmed.checkpoint.releaseSha, releaseVersion: health.releaseVersion, contentVersion: checkpoint.contentVersion, contentHash: checkpoint.contentHash, kvPointerMatches: checkpoint.kvPointerMatches, simulation: {campaignVersion: simulation.campaignVersion, experienceMode: simulation.experienceMode, aiMode: simulation.aiMode, provider: simulation.provider, model: simulation.model, configured: simulation.configured, approvedProviders: simulation.approvedProviders}, travel: {mode: travel.mode, configured: travel.configured, activePublication: travel.activePublication, cleanupHeartbeat: travel.cleanupHeartbeat}});
})()`;

console.log(script);
