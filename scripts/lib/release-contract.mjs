export function exactMigrationNames(output) {
  return [
    ...new Set(String(output).match(/\b\d{4}_[A-Za-z0-9_]+\.sql\b/g) ?? []),
  ];
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
  Object.freeze({ kind: "validate", name: "Validate" }),
  Object.freeze({ kind: "gitleaks", name: "Gitleaks" }),
  Object.freeze({ kind: "codeql", name: "CodeQL" }),
  Object.freeze({ kind: "browser", name: "Browser Quality" }),
]);

export const RELEASE_BROWSER_WORKFLOW_PATH =
  ".github/workflows/browser-quality.yml";

export const ROOM_PLAY_SMOKE_TESTS = Object.freeze([
  "play_watch",
  "play_read",
  "play_listen",
  "play_collect",
  "play_play",
  "play_move",
]);

export function requiredSmokeTestsForPlayMode(base, playExperienceMode) {
  if (!Array.isArray(base) || base.some((value) => typeof value !== "string")) {
    throw new Error("The base smoke-test contract is invalid.");
  }
  if (playExperienceMode === "classic") return [...base];
  if (playExperienceMode === "my-room-2001") {
    return [...base, ...ROOM_PLAY_SMOKE_TESTS];
  }
  throw new Error("The release plan contains an unsupported Play experience mode.");
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
    REQUIRED_VALIDATION_RUNS.map(({ kind, name }) => [kind, name]),
  );
  if (!Array.isArray(runs) || runs.length !== required.size) {
    throw new Error(
      "Release evidence must contain Validate, Gitleaks, CodeQL, and Browser Quality runs.",
    );
  }
  const urls = new Set();
  for (const run of runs) {
    const expectedName = required.get(run?.kind);
    if (!expectedName || urls.has(run.url)) {
      throw new Error("Release validation runs must be distinct and correctly classified.");
    }
    assertVerifiedActionsRun(run, {
      head,
      url: run.url,
      name: expectedName,
    });
    if (
      run.kind === "browser" &&
      (run.event !== "workflow_dispatch" ||
        run.workflowPath !== RELEASE_BROWSER_WORKFLOW_PATH ||
        !Number.isSafeInteger(run.workflowDatabaseId) ||
        run.workflowDatabaseId < 1)
    ) {
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
  { head, contentVersion, preparedAt },
) {
  const checkedAt = Date.parse(marker.checkedAt ?? "");
  if (
    marker.status !== "ready" ||
    marker.details?.releaseSha !== head ||
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
