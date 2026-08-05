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

export function assertRequiredValidationRuns(runs, head, repository) {
  const required = new Map(
    REQUIRED_VALIDATION_RUNS.map((definition) => [definition.kind, definition]),
  );
  if (!Array.isArray(runs) || runs.length !== required.size) {
    throw new Error(
      "Release evidence must contain Validate, Gitleaks, CodeQL, and Browser Quality runs.",
    );
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
