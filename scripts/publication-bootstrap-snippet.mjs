import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RELEASE_BUILD_CHECKPOINT_PATH,
  verifyReleaseBuildCheckpoint,
} from "./lib/release-build-checkpoint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [plan, releaseBuildCheckpoint, releaseBuildCheckpointBytes] =
  await Promise.all([
    readFile(path.join(root, "dist/release-plan.json"), "utf8").then(JSON.parse),
    verifyReleaseBuildCheckpoint(root),
    readFile(path.join(root, RELEASE_BUILD_CHECKPOINT_PATH)),
  ]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
if (
  plan.schemaVersion !== "1.2" ||
  !plan.simulation ||
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
  if (health.releaseSha !== ${JSON.stringify(plan.commitSha)}) throw new Error("Version override did not reach the validated Worker.");
  const simulation = health.simulation;
  const campaignEnabled = ${JSON.stringify(plan.simulation.experienceMode === "campaign-v1")};
  const approvalMismatch = campaignEnabled && (simulation?.providerApprovalDigest !== ${JSON.stringify(plan.simulation.approvalStateDigest)} || JSON.stringify(simulation?.approvedProviders) !== ${JSON.stringify(JSON.stringify(plan.simulation.approvedProviders))});
  if (!simulation || simulation.campaignVersion !== ${JSON.stringify(plan.simulation.campaignVersion)} || simulation.experienceMode !== ${JSON.stringify(plan.simulation.experienceMode)} || simulation.aiMode !== ${JSON.stringify(plan.simulation.aiMode)} || simulation.provider !== ${JSON.stringify(plan.simulation.provider)} || simulation.model !== ${JSON.stringify(plan.simulation.model)} || approvalMismatch || (campaignEnabled && simulation.configured !== true)) {
    throw new Error("The staged simulation configuration or provider-approval state does not match the release plan.");
  }
  const bootstrapRequired = ${JSON.stringify(plan.publicationCheckpoint.status === "predeploy_bootstrap_required")};
  const published = bootstrapRequired ? await readJson("/api/studio/publish", {method: "POST"}) : null;
  const checkpoint = await readJson("/api/studio/publication-checkpoint");
  if (checkpoint.status !== "ready" || checkpoint.contentVersion !== ${JSON.stringify(plan.contentVersion)} || checkpoint.kvPointerMatches !== true) {
    throw new Error("D1/KV publication checkpoint did not reconcile.");
  }
  const confirmed = await readJson("/api/studio/release-checkpoint", {method: "POST"});
  if (confirmed.checkpoint?.releaseSha !== ${JSON.stringify(plan.commitSha)} || confirmed.checkpoint?.contentVersion !== ${JSON.stringify(plan.contentVersion)} || confirmed.checkpoint?.contentHash !== checkpoint.contentHash) {
    throw new Error("The protected release checkpoint did not bind the staged Worker and active publication.");
  }
  console.log({publishedRecords: published?.publication?.recordCount ?? null, releaseSha: confirmed.checkpoint.releaseSha, contentVersion: checkpoint.contentVersion, contentHash: checkpoint.contentHash, kvPointerMatches: checkpoint.kvPointerMatches, simulation: {campaignVersion: simulation.campaignVersion, experienceMode: simulation.experienceMode, aiMode: simulation.aiMode, provider: simulation.provider, model: simulation.model, configured: simulation.configured, approvedProviders: simulation.approvedProviders}});
})()`;

console.log(script);
