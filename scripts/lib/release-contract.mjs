import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { ROOM_OBJECT_CONTRACT } from "../../components/play/room-platform/room-object-contract.ts";

export function exactMigrationNames(output) {
  return [
    ...new Set(String(output).match(/\b\d{4}_[A-Za-z0-9_]+\.sql\b/g) ?? []),
  ];
}

const SIMULATION_APPROVAL_PROVIDERS = Object.freeze([
  "discogs",
  "hardcover",
  "myanimelist",
  "spotify",
  "steam",
  "strava",
]);

function exactSimulationProviderNames(value) {
  const names = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  if (
    new Set(names).size !== names.length ||
    names.some((name) => !SIMULATION_APPROVAL_PROVIDERS.includes(name))
  ) {
    throw new Error(
      "Simulation approval evidence contains an unknown or repeated provider.",
    );
  }
  return [...names].sort();
}

/**
 * Build the sanitized simulation portion of a release record. The caller may
 * pass approval names and a one-way digest, but this contract intentionally
 * has no field for approval references, contacts, notes, or credentials.
 */
export function simulationReleaseRecord({
  campaignVersion,
  experienceMode,
  aiMode,
  provider,
  model,
  approvedProviders,
  approvalStateDigest,
}) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(campaignVersion ?? ""))) {
    throw new Error("The simulation campaign version is invalid.");
  }
  if (!new Set(["disabled", "coming-soon", "campaign-v1"]).has(experienceMode)) {
    throw new Error("The simulation experience mode is invalid.");
  }
  if (!new Set(["live", "authored-only"]).has(aiMode)) {
    throw new Error("The hosted simulation AI mode is invalid.");
  }
  if (provider !== "anthropic" || model !== "claude-sonnet-5") {
    throw new Error("The simulation provider and model do not match the release contract.");
  }
  const providers = exactSimulationProviderNames(approvedProviders);
  const digest = String(approvalStateDigest ?? "").toLowerCase();
  if (experienceMode === "campaign-v1") {
    if (aiMode !== "live") {
      throw new Error("An enabled hosted simulation must use live AI.");
    }
    if (providers.length === 0 || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(
        "An enabled simulation release requires approved provider names and a sanitized approval-state digest.",
      );
    }
  } else if (
    aiMode !== "authored-only" ||
    providers.length > 0 ||
    digest.length > 0
  ) {
    throw new Error(
      "A non-campaign simulation release cannot carry live AI or provider-approval evidence.",
    );
  }
  return {
    campaignVersion,
    experienceMode,
    aiMode,
    provider,
    model,
    approvedProviders: providers,
    approvalStateDigest: experienceMode === "campaign-v1" ? digest : null,
  };
}

export function assertSimulationReleaseRecord(
  record,
  { config, campaignVersion },
) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("The release plan has no simulation evidence.");
  }
  const expected = simulationReleaseRecord({
    campaignVersion,
    experienceMode: config?.vars?.SIMULATION_EXPERIENCE_MODE,
    aiMode: config?.vars?.SIMULATION_AI_MODE,
    provider: config?.vars?.SIMULATION_PROVIDER,
    model: config?.vars?.SIMULATION_MODEL,
    approvedProviders: record.approvedProviders,
    approvalStateDigest: record.approvalStateDigest,
  });
  if (
    Object.keys(record).length !== Object.keys(expected).length ||
    JSON.stringify(record) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "The simulation release evidence is malformed or does not match the prepared Worker configuration.",
    );
  }
  return expected;
}

export const RELEASE_MARKER_QUERY = `SELECT maintenance.status AS status,
                                            maintenance.details_json AS detailsJson,
                                            maintenance.checked_at AS checkedAt,
                                            snapshots.content_hash AS currentContentHash,
                                            json_extract(settings.value_json, '$.contentVersion') AS currentContentVersion
                                     FROM maintenance_state AS maintenance
                                     JOIN editorial_settings AS settings
                                       ON settings.key = 'publication.current'
                                     JOIN publication_snapshots AS snapshots
                                       ON snapshots.id = json_extract(settings.value_json, '$.snapshotId')
                                     WHERE maintenance.key = 'release.publication_ready'
                                     LIMIT 1`;

export function exactVersionIds(output) {
  return [
    ...new Set(
      String(output).match(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      ) ?? [],
    ),
  ];
}

export function assertExactPendingMigrations(pending, planned) {
  if (
    pending.length !== planned.length ||
    !pending.every((value, index) => value === planned[index])
  ) {
    throw new Error(
      `Remote pending migrations (${pending.join(", ") || "none"}) do not exactly match the release plan (${planned.join(", ") || "none"}).`,
    );
  }
}

export async function runGuardedMigration({
  planned,
  listPending,
  apply,
}) {
  const pending = await listPending();
  assertExactPendingMigrations(pending, planned);
  if (planned.length > 0) await apply();
  const remaining = await listPending();
  if (remaining.length > 0) {
    throw new Error(`Remote migrations remain after apply: ${remaining.join(", ")}.`);
  }
  return { applied: planned.length > 0 };
}

export function assertVerifiedActionsRun(evidence, { head, url, name }) {
  if (
    !evidence ||
    evidence.headSha !== head ||
    evidence.conclusion !== "success" ||
    evidence.url !== url.replace(/\/$/, "") ||
    (name && evidence.name !== name)
  ) {
    throw new Error(
      "The GitHub Actions run is not the required successful validation of HEAD.",
    );
  }
}

export const REQUIRED_VALIDATION_RUNS = Object.freeze([
  Object.freeze({
    kind: "validate",
    name: "Validate",
    workflowPath: ".github/workflows/ci.yml",
  }),
  Object.freeze({
    kind: "gitleaks",
    name: "Gitleaks",
    workflowPath: ".github/workflows/gitleaks.yml",
  }),
  Object.freeze({
    kind: "codeql",
    name: "CodeQL",
    workflowPath: ".github/workflows/codeql.yml",
  }),
  Object.freeze({
    kind: "browser",
    name: "Browser Quality",
    workflowPath: ".github/workflows/browser-quality.yml",
  }),
]);

export const RELEASE_EVIDENCE_MODES = Object.freeze({
  githubActions: "github-actions",
  ownerLocal: "owner-local",
});

export const CANONICAL_GITHUB_REPOSITORY =
  "ash0ts/anish-shah-work-in-public";

export const OWNER_LOCAL_CODEQL_RUNNER_LABEL_PATTERN =
  /^anish-release-[a-f0-9]{12}$/u;

export const OWNER_LOCAL_RELEASE_CONFIRMATION =
  "I_ACCEPT_OWNER_LOCAL_RELEASE_EVIDENCE";

export const LOCAL_RELEASE_EVIDENCE_PATH =
  "dist/local-release-evidence.json";

export const OWNER_LOCAL_TOOL_VERSIONS = Object.freeze({
  node: "v24.18.0",
  npm: "11.6.2",
  gitleaks: "8.30.1",
  playwright: "1.62.1",
});

export const OWNER_LOCAL_RESULTS = Object.freeze({
  validate: Object.freeze({
    kind: "validate",
    name: "Validate",
    command: "npm run validate:release:local",
  }),
  gitleaks: Object.freeze({
    kind: "gitleaks",
    name: "Gitleaks",
    command: "gitleaks git --redact --no-banner .",
  }),
  browser: Object.freeze({
    kind: "browser",
    name: "Browser Quality",
    command: "npm run browser:release:existing",
  }),
});

export function selectedReleaseEvidenceMode(environment = process.env) {
  const mode =
    environment.RELEASE_EVIDENCE_MODE?.trim() ||
    RELEASE_EVIDENCE_MODES.githubActions;
  if (!Object.values(RELEASE_EVIDENCE_MODES).includes(mode)) {
    throw new Error(
      "RELEASE_EVIDENCE_MODE must be github-actions or owner-local.",
    );
  }
  const confirmation = environment.RELEASE_OWNER_LOCAL_CONFIRMATION?.trim();
  const codeqlRunnerLabel = environment.RELEASE_CODEQL_RUNNER_LABEL?.trim();
  if (mode === RELEASE_EVIDENCE_MODES.ownerLocal) {
    if (confirmation !== OWNER_LOCAL_RELEASE_CONFIRMATION) {
      throw new Error(
        `Owner-local evidence requires RELEASE_OWNER_LOCAL_CONFIRMATION=${OWNER_LOCAL_RELEASE_CONFIRMATION}.`,
      );
    }
    for (const name of [
      "RELEASE_VALIDATION_URL",
      "RELEASE_GITLEAKS_URL",
      "RELEASE_BROWSER_URL",
    ]) {
      if (environment[name]?.trim()) {
        throw new Error(
          `${name} must be unset when owner-local evidence is selected.`,
        );
      }
    }
    if (!OWNER_LOCAL_CODEQL_RUNNER_LABEL_PATTERN.test(codeqlRunnerLabel ?? "")) {
      throw new Error(
        "Owner-local evidence requires RELEASE_CODEQL_RUNNER_LABEL=anish-release-<12 lowercase hex>.",
      );
    }
  } else if (confirmation || codeqlRunnerLabel) {
    throw new Error(
      "Owner-local confirmation and CodeQL runner label are valid only in owner-local evidence mode.",
    );
  }
  return mode;
}

export function assertOwnerLocalTrustedSource({
  head,
  branch,
  upstreamRef,
  upstreamSha,
  repository,
  worktreeStatus = "",
}) {
  if (
    !/^[a-f0-9]{40}$/u.test(head ?? "") ||
    branch !== "main" ||
    upstreamRef !== "origin/main" ||
    upstreamSha !== head ||
    repository !== CANONICAL_GITHUB_REPOSITORY ||
    worktreeStatus
  ) {
    throw new Error(
      "Owner-local release evidence requires a clean exact origin/main head of the canonical repository.",
    );
  }
  return {
    head,
    ref: "refs/heads/main",
    repository: CANONICAL_GITHUB_REPOSITORY,
  };
}

const OWNER_LOCAL_RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "mode",
  "repository",
  "ref",
  "commitSha",
  "completedAt",
  "tools",
  "artifact",
  "results",
  "payloadSha256",
]);

const OWNER_LOCAL_RESULT_KEYS = Object.freeze([
  "kind",
  "name",
  "command",
  "status",
  "startedAt",
  "completedAt",
  "exitCode",
  "outputSha256",
  "artifactSetSha256",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactObjectKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function canonicalize(value) {
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

export function ownerLocalEvidencePayloadSha256(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("The owner-local release receipt is unreadable.");
  }
  const payload = { ...receipt };
  delete payload.payloadSha256;
  return sha256(JSON.stringify(canonicalize(payload)));
}

function canonicalIsoTimestamp(value, label) {
  const parsed = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function exactArtifactEvidence(value, expected) {
  const keys = [
    "artifactSetSha256",
    "deployableManifestSha256",
    "releaseBuildCheckpointSha256",
  ];
  return (
    exactObjectKeys(value, keys) &&
    keys.every(
      (key) =>
        /^[a-f0-9]{64}$/u.test(value[key]) && value[key] === expected?.[key],
    )
  );
}

/**
 * Verify the owner-run release evidence without trusting a URL or a mutable
 * console transcript. The receipt is exact-SHA/ref/repository bound, names
 * three fixed commands, and binds every result to the same deployable bytes.
 */
export function assertOwnerLocalEvidenceReceipt(
  receipt,
  receiptBytes,
  {
    head,
    repository,
    ref,
    artifact,
    notBefore,
    notAfter = new Date().toISOString(),
  },
) {
  if (!exactObjectKeys(receipt, OWNER_LOCAL_RECEIPT_KEYS)) {
    throw new Error("The owner-local release receipt has an unexpected shape.");
  }
  if (
    receipt.schemaVersion !== "1.0" ||
    receipt.mode !== RELEASE_EVIDENCE_MODES.ownerLocal ||
    receipt.commitSha !== head ||
    receipt.repository !== repository ||
    receipt.repository !== CANONICAL_GITHUB_REPOSITORY ||
    receipt.ref !== ref ||
    receipt.ref !== "refs/heads/main"
  ) {
    throw new Error(
      "The owner-local release receipt does not match the exact pushed SHA, trusted ref, and repository.",
    );
  }
  if (
    !exactObjectKeys(receipt.tools, Object.keys(OWNER_LOCAL_TOOL_VERSIONS)) ||
    JSON.stringify(receipt.tools) !== JSON.stringify(OWNER_LOCAL_TOOL_VERSIONS)
  ) {
    throw new Error("The owner-local release receipt used an unpinned toolchain.");
  }
  if (!exactArtifactEvidence(receipt.artifact, artifact)) {
    throw new Error(
      "The owner-local release receipt does not match the exact deployable artifact.",
    );
  }
  if (
    !exactObjectKeys(receipt.results, Object.keys(OWNER_LOCAL_RESULTS)) ||
    !/^[a-f0-9]{64}$/u.test(receipt.payloadSha256) ||
    receipt.payloadSha256 !== ownerLocalEvidencePayloadSha256(receipt)
  ) {
    throw new Error("The owner-local release receipt is missing, stale, or mutated.");
  }

  const notBeforeTime = Date.parse(
    canonicalIsoTimestamp(notBefore, "Owner-local receipt lower bound"),
  );
  const notAfterTime = Date.parse(
    canonicalIsoTimestamp(notAfter, "Owner-local receipt upper bound"),
  );
  const artifactSetSha256 = receipt.artifact.artifactSetSha256;
  let latestResultTime = 0;
  for (const [resultKey, expected] of Object.entries(OWNER_LOCAL_RESULTS)) {
    const result = receipt.results[resultKey];
    if (
      !exactObjectKeys(result, OWNER_LOCAL_RESULT_KEYS) ||
      result.kind !== expected.kind ||
      result.name !== expected.name ||
      result.command !== expected.command ||
      result.status !== "pass" ||
      result.exitCode !== 0 ||
      !/^[a-f0-9]{64}$/u.test(result.outputSha256) ||
      result.artifactSetSha256 !== artifactSetSha256
    ) {
      throw new Error(
        `The owner-local ${expected.name} result is not an exact successful artifact-bound gate.`,
      );
    }
    const startedAt = canonicalIsoTimestamp(
      result.startedAt,
      `${expected.name} startedAt`,
    );
    const completedAt = canonicalIsoTimestamp(
      result.completedAt,
      `${expected.name} completedAt`,
    );
    if (
      Date.parse(completedAt) < Date.parse(startedAt) ||
      Date.parse(startedAt) < notBeforeTime ||
      Date.parse(completedAt) > notAfterTime + 5 * 60 * 1000
    ) {
      throw new Error(
        `The owner-local ${expected.name} result has a stale or invalid time range.`,
      );
    }
    latestResultTime = Math.max(latestResultTime, Date.parse(completedAt));
  }

  const completedAt = canonicalIsoTimestamp(
    receipt.completedAt,
    "Owner-local receipt completedAt",
  );
  if (
    Date.parse(completedAt) !== latestResultTime ||
    latestResultTime < notBeforeTime ||
    latestResultTime > notAfterTime + 5 * 60 * 1000
  ) {
    throw new Error("The owner-local release receipt is stale or has an invalid time range.");
  }
  if (
    !Buffer.isBuffer(receiptBytes) ||
    !receiptBytes.equals(
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
    )
  ) {
    throw new Error(
      "The owner-local release receipt bytes are unavailable or noncanonical.",
    );
  }

  return {
    mode: RELEASE_EVIDENCE_MODES.ownerLocal,
    ownerConfirmed: true,
    receiptPath: LOCAL_RELEASE_EVIDENCE_PATH,
    receiptSha256: sha256(receiptBytes),
    payloadSha256: receipt.payloadSha256,
    completedAt,
    localResults: Object.keys(OWNER_LOCAL_RESULTS),
    githubResults: ["codeql"],
  };
}

export async function readOwnerLocalEvidenceReceipt(root) {
  const receiptPath = path.join(root, LOCAL_RELEASE_EVIDENCE_PATH);
  let metadata;
  let receiptBytes;
  try {
    metadata = await lstat(receiptPath);
    receiptBytes = await readFile(receiptPath);
  } catch {
    throw new Error(
      `Owner-local release evidence is missing at ${LOCAL_RELEASE_EVIDENCE_PATH}.`,
    );
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new Error(
      "The owner-local release receipt must be a regular 0600 file.",
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    throw new Error("The owner-local release receipt is unreadable.");
  }
  if (
    !receiptBytes.equals(
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
    )
  ) {
    throw new Error(
      "The owner-local release receipt is not in its canonical file form.",
    );
  }
  return { receipt, receiptBytes };
}

export const RELEASE_BROWSER_WORKFLOW_PATH =
  REQUIRED_VALIDATION_RUNS.find(({ kind }) => kind === "browser").workflowPath;

export function assertActiveActionsWorkflow(
  workflow,
  { workflowDatabaseId, name, workflowPath },
) {
  if (
    !Number.isSafeInteger(workflowDatabaseId) ||
    workflowDatabaseId < 1 ||
    workflow?.id !== workflowDatabaseId ||
    workflow?.name !== name ||
    workflow?.path !== workflowPath ||
    workflow?.state !== "active"
  ) {
    throw new Error(
      `${name} evidence does not belong to the exact active ${workflowPath} workflow.`,
    );
  }
  return {
    workflowDatabaseId,
    workflowPath,
    workflowState: "active",
  };
}

export const ROOM_PLAY_SMOKE_TESTS = Object.freeze(
  ROOM_OBJECT_CONTRACT.filter(({ id }) => id !== "travel").map(
    ({ smokeTest }) => smokeTest,
  ),
);

export const TRAVEL_PLAY_SMOKE_TEST = ROOM_OBJECT_CONTRACT.find(
  ({ id }) => id === "travel",
).smokeTest;

export function releaseTravelHealthMatches(travel, expectedMode) {
  if (expectedMode === "disabled") {
    return travel?.mode === "disabled";
  }
  if (expectedMode !== "atlas-v1") {
    return false;
  }

  const contentHash = travel?.activePublication?.contentHash;
  const tripCount = travel?.activePublication?.counts?.trips;
  return (
    travel?.mode === "atlas-v1" &&
    travel.configured === true &&
    typeof contentHash === "string" &&
    /^[a-f0-9]{64}$/u.test(contentHash) &&
    Number.isSafeInteger(tripCount) &&
    tripCount >= 1 &&
    travel.cleanupHeartbeat?.status === "current"
  );
}

export function requiredPlaySmokeTests(base, { travelEnabled = false } = {}) {
  if (!Array.isArray(base) || base.some((value) => typeof value !== "string")) {
    throw new Error("The base smoke-test contract is invalid.");
  }
  if (typeof travelEnabled !== "boolean") {
    throw new Error("The Travel smoke-test switch is invalid.");
  }
  return [
    ...base,
    ...ROOM_PLAY_SMOKE_TESTS,
    ...(travelEnabled ? [TRAVEL_PLAY_SMOKE_TEST] : []),
  ];
}

export function githubRepositoryFromRemoteUrl(value) {
  const scp = String(value).match(
    /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/,
  );
  if (scp) return `${scp[1].toLowerCase()}/${scp[2].toLowerCase()}`;
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("The configured upstream is not a supported GitHub remote.");
  }
  if (
    !["https:", "ssh:"].includes(url.protocol) ||
    url.hostname.toLowerCase() !== "github.com" ||
    (url.protocol === "https:" && (url.username || url.password))
  ) {
    throw new Error("The configured upstream is not a supported GitHub remote.");
  }
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/,
  );
  if (!match) {
    throw new Error("The configured upstream is not a two-segment GitHub repository.");
  }
  return `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
}

function assertRequiredActionsRuns(runs, head, repository, requirements) {
  const required = new Map(
    requirements.map((definition) => [definition.kind, definition]),
  );
  if (!Array.isArray(runs) || runs.length !== required.size) {
    const names = requirements.map(({ name }) => name).join(", ");
    throw new Error(`Release evidence must contain exactly: ${names}.`);
  }
  const urls = new Set();
  const workflowIds = new Set();
  for (const run of runs) {
    const expected = required.get(run?.kind);
    if (!expected || urls.has(run.url)) {
      throw new Error("Release validation runs must be distinct and correctly classified.");
    }
    assertVerifiedActionsRun(run, {
      head,
      url: run.url,
      name: expected.name,
    });
    if (
      !Number.isSafeInteger(run.workflowDatabaseId) ||
      run.workflowDatabaseId < 1 ||
      workflowIds.has(run.workflowDatabaseId) ||
      run.workflowPath !== expected.workflowPath ||
      run.workflowState !== "active"
    ) {
      throw new Error(
        `${expected.name} release evidence must identify the exact active ${expected.workflowPath} workflow.`,
      );
    }
    if (run.kind === "browser" && run.event !== "workflow_dispatch") {
      throw new Error(
        "Browser release evidence must be a manual workflow_dispatch run of the exact browser-quality workflow file.",
      );
    }
    if (repository) {
      const url = new URL(run.url);
      const segments = url.pathname.split("/").filter(Boolean);
      const actualRepository = `${segments[0]?.toLowerCase()}/${segments[1]?.toLowerCase()}`;
      if (url.hostname !== "github.com" || actualRepository !== repository) {
        throw new Error(
          "Release validation evidence must belong to the configured upstream repository.",
        );
      }
    }
    urls.add(run.url);
    workflowIds.add(run.workflowDatabaseId);
    required.delete(run.kind);
  }
  if (required.size > 0) {
    throw new Error("Release evidence is missing a required validation run.");
  }
}

export function assertRequiredValidationRuns(runs, head, repository) {
  try {
    return assertRequiredActionsRuns(
      runs,
      head,
      repository,
      REQUIRED_VALIDATION_RUNS,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Release evidence must contain exactly:")
    ) {
      throw new Error(
        "Release evidence must contain Validate, Gitleaks, CodeQL, and Browser Quality runs.",
      );
    }
    throw error;
  }
}

export function assertRequiredCodeqlValidationRun(
  runs,
  head,
  repository,
  expectedRunnerLabel,
) {
  const codeql = REQUIRED_VALIDATION_RUNS.filter(({ kind }) => kind === "codeql");
  assertRequiredActionsRuns(runs, head, repository, codeql);
  const runner = runs[0]?.runner;
  const expectedRunnerKeys = [
    "jobDatabaseId",
    "jobName",
    "jitLabel",
    "labels",
  ];
  const labels = runner?.labels;
  if (
    runs[0]?.event !== "workflow_dispatch" ||
    !exactObjectKeys(runner, expectedRunnerKeys) ||
    !Number.isSafeInteger(runner.jobDatabaseId) ||
    runner.jobDatabaseId < 1 ||
    runner.jobName !== "analyze" ||
    !OWNER_LOCAL_CODEQL_RUNNER_LABEL_PATTERN.test(runner.jitLabel ?? "") ||
    (expectedRunnerLabel && runner.jitLabel !== expectedRunnerLabel) ||
    !Array.isArray(labels) ||
    JSON.stringify(labels) !== JSON.stringify([...new Set(labels)].sort()) ||
    !["self-hosted", "linux", "x64", runner.jitLabel].every((label) =>
      labels.includes(label),
    )
  ) {
    throw new Error(
      "Owner-local release evidence requires an exact-SHA workflow_dispatch CodeQL run on the exact disposable Linux x64 runner.",
    );
  }
}

export function githubActionsValidationEvidence() {
  return {
    mode: RELEASE_EVIDENCE_MODES.githubActions,
    ownerConfirmed: false,
    receiptPath: null,
    receiptSha256: null,
    payloadSha256: null,
    completedAt: null,
    localResults: [],
    githubResults: REQUIRED_VALIDATION_RUNS.map(({ kind }) => kind),
  };
}

export function assertReleaseValidationEvidence(
  validationEvidence,
  validationRuns,
  {
    head,
    repository,
    ref,
    artifact,
    notBefore,
    notAfter,
    localReceipt,
    localReceiptBytes,
  },
) {
  if (validationEvidence?.mode === RELEASE_EVIDENCE_MODES.githubActions) {
    const expected = githubActionsValidationEvidence();
    if (JSON.stringify(validationEvidence) !== JSON.stringify(expected)) {
      throw new Error("The GitHub Actions validation-evidence record is malformed.");
    }
    assertRequiredValidationRuns(validationRuns, head, repository);
    return expected;
  }
  if (validationEvidence?.mode !== RELEASE_EVIDENCE_MODES.ownerLocal) {
    throw new Error("The release validation-evidence mode is missing or unsupported.");
  }
  assertRequiredCodeqlValidationRun(validationRuns, head, repository);
  const verified = assertOwnerLocalEvidenceReceipt(
    localReceipt,
    localReceiptBytes,
    { head, repository, ref, artifact, notBefore, notAfter },
  );
  if (JSON.stringify(validationEvidence) !== JSON.stringify(verified)) {
    throw new Error(
      "The owner-local release receipt is missing, stale, mutated, or does not match the release plan.",
    );
  }
  return verified;
}

export function assertProductionDeployment(output, version) {
  let deployment;
  try {
    deployment = JSON.parse(output);
  } catch {
    throw new Error("The production deployment status returned unreadable JSON.");
  }
  const versions = deployment?.versions;
  if (
    !Array.isArray(versions) ||
    versions.length !== 1 ||
    versions[0]?.version_id !== version ||
    versions[0]?.percentage !== 100
  ) {
    throw new Error(
      "The release attestation requires the exact Worker version at 100% production traffic.",
    );
  }
  return {
    deploymentId:
      typeof deployment.id === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(deployment.id)
        ? deployment.id
        : null,
    versionId: version,
    percentage: 100,
  };
}

export function publicationCheckpointForPlan({
  hash,
  contentVersion,
  kvPointerMatches,
  releaseContentVersion,
  bootstrapPlanned,
  previousVersion,
}) {
  const normalizedHash = String(hash).toLowerCase();
  const normalizedVersion = String(contentVersion).toLowerCase();
  if (
    !(/^[a-f0-9]{64}$/.test(normalizedHash) || normalizedHash === "none") ||
    !(/^[a-f0-9]{16}$/.test(normalizedVersion) || normalizedVersion === "none") ||
    (normalizedHash === "none") !== (normalizedVersion === "none")
  ) {
    throw new Error("The publication checkpoint values are invalid.");
  }
  const compatible =
    normalizedHash !== "none" &&
    normalizedVersion === releaseContentVersion &&
    kvPointerMatches;
  if (!compatible && !bootstrapPlanned) {
    throw new Error(
      "The current D1/KV publication is incompatible. Abort or explicitly plan the zero-traffic pre-deploy bootstrap.",
    );
  }
  if (!compatible && !previousVersion) {
    throw new Error(
      "A zero-traffic publication bootstrap requires an existing Worker version.",
    );
  }
  return {
    status: compatible ? "compatible" : "predeploy_bootstrap_required",
    contentHash: normalizedHash === "none" ? null : normalizedHash,
    contentVersion: normalizedVersion === "none" ? null : normalizedVersion,
    kvPointerMatches,
  };
}

export function requireExactUploadedVersion(output, version) {
  if (!exactVersionIds(output).includes(version)) {
    throw new Error("RELEASE_WORKER_VERSION is not present in the uploaded version list.");
  }
}

export function parseRemoteReleaseMarker(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("The remote release-marker query returned unreadable JSON.");
  }
  const row = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])[0]
    : null;
  if (!row || typeof row.detailsJson !== "string") {
    throw new Error("The remote release marker is missing.");
  }
  let details;
  try {
    details = JSON.parse(row.detailsJson);
  } catch {
    throw new Error("The remote release marker details are unreadable.");
  }
  return { ...row, details };
}

export function assertReleaseMarker(
  marker,
  { head, releaseVersion, contentVersion, preparedAt },
) {
  const checkedAt = Date.parse(marker.checkedAt ?? "");
  if (
    marker.status !== "ready" ||
    marker.details?.releaseSha !== head ||
    marker.details?.releaseVersion !== releaseVersion ||
    marker.details?.contentVersion !== contentVersion ||
    !/^[a-f0-9]{64}$/.test(marker.details?.contentHash ?? "") ||
    marker.currentContentHash !== marker.details.contentHash ||
    marker.currentContentVersion !== contentVersion ||
    marker.details?.verifiedAt !== marker.checkedAt ||
    !Number.isFinite(checkedAt) ||
    checkedAt < Date.parse(preparedAt)
  ) {
    throw new Error(
      "The remote D1/KV release marker is missing, stale, or does not match the validated release.",
    );
  }
}
