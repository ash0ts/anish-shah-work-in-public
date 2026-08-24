import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertOwnerLocalTrustedSource,
  CANONICAL_GITHUB_REPOSITORY,
  LOCAL_RELEASE_EVIDENCE_PATH,
  OWNER_LOCAL_RESULTS,
  OWNER_LOCAL_TOOL_VERSIONS,
} from "./release-contract.mjs";

export { LOCAL_RELEASE_EVIDENCE_PATH };

export const LOCAL_RELEASE_EVIDENCE_COMMANDS = Object.freeze(
  Object.fromEntries(
    Object.entries(OWNER_LOCAL_RESULTS).map(([kind, result]) => [
      kind,
      result.command,
    ]),
  ),
);

export const LOCAL_RELEASE_EVIDENCE_NAMES = Object.freeze(
  Object.fromEntries(
    Object.entries(OWNER_LOCAL_RESULTS).map(([kind, result]) => [
      kind,
      result.name,
    ]),
  ),
);

export const LOCAL_RELEASE_GATE_TIMEOUT_MS = Object.freeze({
  validate: 35 * 60_000,
  gitleaks: 10 * 60_000,
  browser: 20 * 60_000,
});

// The workflow-aligned gate budgets total 65 minutes. Five additional minutes
// bound setup, exact-SHA checks, artifact verification, and process shutdown.
export const LOCAL_RELEASE_OVERALL_TIMEOUT_MS = 70 * 60_000;
export const LOCAL_RELEASE_CONTROL_TIMEOUT_MS = 30_000;
export const LOCAL_RELEASE_TERMINATION_GRACE_MS = 10_000;
export const LOCAL_RELEASE_FORCE_EXIT_WAIT_MS = 5_000;

const RESULT_KINDS = Object.freeze(Object.keys(OWNER_LOCAL_RESULTS));
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9.+_-]{1,64}$/u;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactMillisecond(value, label, { allowZero = false } = {}) {
  if (
    !Number.isSafeInteger(value) ||
    (allowZero ? value < 0 : value < 1)
  ) {
    throw new Error(`${label} must be a positive safe-integer millisecond value.`);
  }
  return value;
}

export function localReleaseOverallDeadline(startedAtMs) {
  exactMillisecond(startedAtMs, "Owner-local start time", { allowZero: true });
  return startedAtMs + LOCAL_RELEASE_OVERALL_TIMEOUT_MS;
}

export function localReleaseGateBudget({
  kind,
  startedAtMs,
  overallDeadlineMs,
}) {
  const gateTimeoutMs = LOCAL_RELEASE_GATE_TIMEOUT_MS[kind];
  if (!gateTimeoutMs) {
    throw new Error(`Unknown owner-local release gate: ${kind}.`);
  }
  exactMillisecond(startedAtMs, "Gate start time", { allowZero: true });
  exactMillisecond(overallDeadlineMs, "Owner-local overall deadline");
  const remainingOverallMs = overallDeadlineMs - startedAtMs;
  if (remainingOverallMs <= 0) {
    throw new Error(
      `Owner-local release evidence exceeded its overall deadline before ${LOCAL_RELEASE_EVIDENCE_NAMES[kind]}.`,
    );
  }
  const timeoutMs = Math.min(gateTimeoutMs, remainingOverallMs);
  return {
    deadlineMs: startedAtMs + timeoutMs,
    timeoutMs,
    limitedBy: remainingOverallMs <= gateTimeoutMs ? "overall" : "gate",
  };
}

export function localReleaseControlTimeout({ nowMs, overallDeadlineMs }) {
  exactMillisecond(nowMs, "Control-command start time", { allowZero: true });
  exactMillisecond(overallDeadlineMs, "Owner-local overall deadline");
  const remainingMs = overallDeadlineMs - nowMs;
  if (remainingMs <= 0) {
    throw new Error("Owner-local release evidence exceeded its overall deadline.");
  }
  return Math.min(LOCAL_RELEASE_CONTROL_TIMEOUT_MS, remainingMs);
}

export function localReleaseGateTimeoutError(kind, budget) {
  const name = LOCAL_RELEASE_EVIDENCE_NAMES[kind];
  if (!name || !budget || !Number.isSafeInteger(budget.timeoutMs)) {
    throw new Error("Owner-local release gate timeout metadata is invalid.");
  }
  if (budget.limitedBy === "overall") {
    return new Error(
      `Owner-local release evidence exceeded its overall deadline during ${name}.`,
    );
  }
  return new Error(
    `${name} exceeded its ${Math.round(budget.timeoutMs / 60_000)}-minute owner-local deadline.`,
  );
}

export function localReleaseProcessGroupTarget(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw new Error("Owner-local gate process has an invalid PID.");
  }
  if (platform === "win32") {
    throw new Error(
      "Owner-local release evidence requires POSIX process-group termination.",
    );
  }
  return -pid;
}

export function localReleaseProcessGroupExists({
  pid,
  platform = process.platform,
  signalProcess = process.kill,
}) {
  const target = localReleaseProcessGroupTarget(pid, platform);
  try {
    signalProcess(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

export function createLocalReleaseProcessGroupTerminator({
  pid,
  platform = process.platform,
  signalProcess = process.kill,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  graceMs = LOCAL_RELEASE_TERMINATION_GRACE_MS,
  onSignalError = () => {},
}) {
  const target = localReleaseProcessGroupTarget(pid, platform);
  exactMillisecond(graceMs, "Process termination grace period");
  let forceKillTimer;
  let started = false;

  const send = (signal) => {
    try {
      signalProcess(target, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") onSignalError(error, signal);
    }
  };

  return {
    begin() {
      if (started) return false;
      started = true;
      send("SIGTERM");
      forceKillTimer = schedule(() => {
        forceKillTimer = undefined;
        send("SIGKILL");
      }, graceMs);
      forceKillTimer?.unref?.();
      return true;
    },
    cancel() {
      if (forceKillTimer !== undefined) {
        cancelSchedule(forceKillTimer);
        forceKillTimer = undefined;
      }
    },
  };
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalPayloadSha256(payload) {
  return sha256(JSON.stringify(canonicalize(payload)));
}

export function exactLocalReleaseRef(branch) {
  if (branch === "main") return "refs/heads/main";
  throw new Error("Owner-local production release evidence requires main.");
}

export function assertExactLocalReleaseState({
  head,
  expectedSha,
  worktreeStatus,
  branch,
  upstreamRef,
  upstream,
  repository,
}) {
  const normalizedHead = String(head ?? "").toLowerCase();
  if (
    !COMMIT_SHA_PATTERN.test(normalizedHead) ||
    String(expectedSha ?? "").toLowerCase() !== normalizedHead
  ) {
    throw new Error(
      "RELEASE_VALIDATED_SHA must be the exact 40-character local HEAD.",
    );
  }
  exactLocalReleaseRef(branch);
  return assertOwnerLocalTrustedSource({
    head: normalizedHead,
    branch,
    upstreamRef,
    upstreamSha: String(upstream ?? "").toLowerCase(),
    repository,
    worktreeStatus: String(worktreeStatus ?? ""),
  });
}

function exactIso(value, label) {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function exactSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function exactResult(kind, result, artifactSetSha256) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${LOCAL_RELEASE_EVIDENCE_NAMES[kind]} result is missing.`);
  }
  const expectedKeys = [
    "kind",
    "name",
    "command",
    "status",
    "startedAt",
    "completedAt",
    "exitCode",
    "outputSha256",
    "artifactSetSha256",
  ].sort();
  if (JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `${LOCAL_RELEASE_EVIDENCE_NAMES[kind]} result has unexpected fields.`,
    );
  }
  if (
    result.kind !== kind ||
    result.name !== LOCAL_RELEASE_EVIDENCE_NAMES[kind] ||
    result.command !== LOCAL_RELEASE_EVIDENCE_COMMANDS[kind] ||
    result.status !== "pass" ||
    result.exitCode !== 0 ||
    result.artifactSetSha256 !== artifactSetSha256
  ) {
    throw new Error(
      `${LOCAL_RELEASE_EVIDENCE_NAMES[kind]} did not pass the exact owner-local command against the release artifact.`,
    );
  }
  const startedAt = exactIso(result.startedAt, `${kind}.startedAt`);
  const completedAt = exactIso(result.completedAt, `${kind}.completedAt`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error(`${kind} completed before it started.`);
  }
  exactSha256(result.outputSha256, `${kind}.outputSha256`);
  return result;
}

export function buildOwnerLocalEvidenceReceipt({
  repository,
  ref,
  commitSha,
  tools,
  artifact,
  results,
}) {
  if (repository !== CANONICAL_GITHUB_REPOSITORY) {
    throw new Error("Owner-local evidence has an invalid GitHub repository.");
  }
  if (
    ref !== "refs/heads/main"
  ) {
    throw new Error("Owner-local evidence has an invalid trusted ref.");
  }
  if (!COMMIT_SHA_PATTERN.test(commitSha ?? "")) {
    throw new Error("Owner-local evidence has an invalid commit SHA.");
  }
  const expectedToolKeys = Object.keys(OWNER_LOCAL_TOOL_VERSIONS);
  if (
    !tools ||
    JSON.stringify(Object.keys(tools).sort()) !==
      JSON.stringify([...expectedToolKeys].sort()) ||
    expectedToolKeys.some(
      (key) =>
        !VERSION_PATTERN.test(tools[key] ?? "") ||
        tools[key] !== OWNER_LOCAL_TOOL_VERSIONS[key],
    )
  ) {
    throw new Error("Owner-local evidence has incomplete tool versions.");
  }
  const expectedArtifactKeys = [
    "artifactSetSha256",
    "deployableManifestSha256",
    "releaseBuildCheckpointSha256",
  ];
  if (
    !artifact ||
    JSON.stringify(Object.keys(artifact).sort()) !==
      JSON.stringify([...expectedArtifactKeys].sort())
  ) {
    throw new Error("Owner-local evidence has malformed artifact identity.");
  }
  for (const key of expectedArtifactKeys) {
    exactSha256(artifact[key], `artifact.${key}`);
  }
  if (
    !results ||
    JSON.stringify(Object.keys(results).sort()) !==
      JSON.stringify([...RESULT_KINDS].sort())
  ) {
    throw new Error(
      "Owner-local evidence requires exactly Validate, Gitleaks, and Browser Quality.",
    );
  }
  const exactResults = Object.fromEntries(
    RESULT_KINDS.map((kind) => [
      kind,
      exactResult(kind, results[kind], artifact.artifactSetSha256),
    ]),
  );
  const completedAt = exactResults.browser.completedAt;
  if (
    RESULT_KINDS.some(
      (kind) => Date.parse(exactResults[kind].completedAt) > Date.parse(completedAt),
    )
  ) {
    throw new Error("Receipt completion must follow every local evidence gate.");
  }
  const payload = {
    schemaVersion: "1.0",
    mode: "owner-local",
    repository,
    ref,
    commitSha,
    completedAt,
    tools,
    artifact,
    results: exactResults,
  };
  return {
    ...payload,
    payloadSha256: canonicalPayloadSha256(payload),
  };
}

export async function writeOwnerLocalEvidenceReceipt(root, receipt) {
  const destination = path.join(root, LOCAL_RELEASE_EVIDENCE_PATH);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  // writeFile honors the process umask; chmod makes the final requirement
  // explicit. Exclusive creation also refuses a raced file or symlink.
  await chmod(destination, 0o600);
  const fileStats = await stat(destination);
  if ((fileStats.mode & 0o777) !== 0o600) {
    throw new Error("Owner-local evidence receipt must use mode 0600.");
  }
  return {
    path: destination,
    sha256: sha256(await readFile(destination)),
  };
}

export async function removeOwnerLocalEvidenceReceipt(root) {
  await unlink(path.join(root, LOCAL_RELEASE_EVIDENCE_PATH)).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}
