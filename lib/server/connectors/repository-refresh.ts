import { classifyDatabaseError } from "../database-errors";
import { fetchDiscogsSnapshot } from "./discogs";
import {
  clearDiscogsRetry,
  discogsRetryNotBefore,
  recordDiscogsRetryAfter,
} from "./discogs-retry";
import { fetchHardcoverSnapshot } from "./hardcover";
import { fetchMyAnimeListSnapshot } from "./myanimelist";
import {
  isMyAnimeListOAuthCredential,
  refreshMyAnimeListOAuthCredential,
  shouldRefreshMyAnimeListToken,
} from "./myanimelist-oauth";
import { validateConnectorPublicPayload } from "./public-payload-policy";
import {
  loadCredential,
  persistRefreshedMyAnimeListCredential,
  persistRefreshedSpotifyCredential,
} from "./repository-credentials";
import { databaseOrNull } from "./repository-primitives";
import { pruneConnectorRetention } from "./repository-retention";
import type { RefreshResult } from "./repository-contracts";
import { fetchSpotifySnapshot } from "./spotify";
import {
  isSpotifyOAuthCredential,
  refreshSpotifyOAuthCredential,
  shouldRefreshSpotifyToken,
} from "./spotify-oauth";
import { fetchSteamSnapshot } from "./steam";
import { steamStorageCountries } from "./steam-policy";
import {
  ConnectorFetchError,
  type ConnectorCredential,
  type ConnectorFetchResult,
  type ConnectorProvider,
  type DiscogsOAuthCredential,
  type HardcoverCredential,
  type MyAnimeListCredential,
  type SpotifyOAuthCredential,
  type SteamCredential,
  type SyncTrigger,
} from "./types";

const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;
const DISCOGS_FRESHNESS_WINDOW_MS = 4 * 60 * 60 * 1000;
const RUN_LOCK_WINDOW_MS = 10 * 60 * 1000;

function freshnessWindow(provider: ConnectorProvider): number {
  return provider === "discogs"
    ? DISCOGS_FRESHNESS_WINDOW_MS
    : FRESHNESS_WINDOW_MS;
}

function retainedSnapshotCount(provider: ConnectorProvider): number {
  return provider === "discogs" ? 1 : 2;
}

async function discogsManualRefreshNotBefore(
  database: D1Database,
): Promise<string | null> {
  const snapshot = await database
    .prepare(
      `SELECT fetched_at AS fetchedAt
       FROM connector_snapshots
       WHERE provider = 'discogs' AND status = 'ready'
       ORDER BY fetched_at DESC, id DESC
       LIMIT 1`,
    )
    .first<{ fetchedAt: string }>();
  if (!snapshot) return null;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return null;
  const nextEligibleAt = fetchedAt + DISCOGS_FRESHNESS_WINDOW_MS;
  return Date.now() < nextEligibleAt
    ? new Date(nextEligibleAt).toISOString()
    : null;
}

async function fetchConnectorSnapshot(
  database: D1Database,
  provider: ConnectorProvider,
  credential: ConnectorCredential,
  expectedGeneration: number,
): Promise<ConnectorFetchResult> {
  switch (provider) {
    case "myanimelist": {
      let current = credential as MyAnimeListCredential;
      if (
        isMyAnimeListOAuthCredential(current) &&
        shouldRefreshMyAnimeListToken(current)
      ) {
        const refreshed = await refreshMyAnimeListOAuthCredential(current);
        await persistRefreshedMyAnimeListCredential(
          database,
          refreshed,
          expectedGeneration,
        );
        current = refreshed;
      }

      try {
        return await fetchMyAnimeListSnapshot(current);
      } catch (error) {
        if (
          !isMyAnimeListOAuthCredential(current) ||
          !(error instanceof ConnectorFetchError) ||
          error.code !== "credential_expired"
        ) {
          throw error;
        }
      }

      if (!isMyAnimeListOAuthCredential(current)) {
        throw new ConnectorFetchError(
          "MyAnimeList authorization needs to be renewed.",
          { code: "credential_expired", httpStatus: 401 },
        );
      }
      const refreshed = await refreshMyAnimeListOAuthCredential(current);
      await persistRefreshedMyAnimeListCredential(
        database,
        refreshed,
        expectedGeneration,
      );
      return fetchMyAnimeListSnapshot(refreshed);
    }
    case "hardcover":
      return fetchHardcoverSnapshot(credential as HardcoverCredential);
    case "spotify": {
      let current = credential as SpotifyOAuthCredential;
      if (!isSpotifyOAuthCredential(current)) {
        throw new ConnectorFetchError(
          "Spotify authorization needs to be renewed.",
          { code: "reauthorization_required" },
        );
      }
      if (shouldRefreshSpotifyToken(current)) {
        current = await refreshSpotifyOAuthCredential(current);
        await persistRefreshedSpotifyCredential(
          database,
          current,
          expectedGeneration,
        );
      }
      try {
        return await fetchSpotifySnapshot(current);
      } catch (error) {
        if (
          !(error instanceof ConnectorFetchError) ||
          error.code !== "credential_expired"
        ) {
          throw error;
        }
      }
      current = await refreshSpotifyOAuthCredential(current);
      await persistRefreshedSpotifyCredential(
        database,
        current,
        expectedGeneration,
      );
      return fetchSpotifySnapshot(current);
    }
    case "discogs":
      return fetchDiscogsSnapshot(credential as DiscogsOAuthCredential);
    case "steam":
      return fetchSteamSnapshot(credential as SteamCredential);
  }
}

function safeError(error: unknown): {
  code: string;
  message: string;
  httpStatus: number | null;
  retryable: boolean;
  retryAfterSeconds: number | null;
} {
  if (error instanceof ConnectorFetchError) {
    return {
      code: error.code,
      message: error.message,
      httpStatus: error.httpStatus,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  const databaseFailure = classifyDatabaseError(error);
  if (databaseFailure !== "database_error") {
    return {
      code: databaseFailure,
      message: "Connector persistence is not ready.",
      httpStatus: null,
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  return {
    code: "sync_failed",
    message: "The connector sync failed before a new snapshot was saved.",
    httpStatus: null,
    retryable: true,
    retryAfterSeconds: null,
  };
}

export async function refreshConnector(
  provider: ConnectorProvider,
  trigger: SyncTrigger,
  requestedByEmail: string | null,
): Promise<RefreshResult> {
  const database = databaseOrNull();
  if (!database) {
    return { status: "setup_required", provider, reason: "database" };
  }
  return refreshConnectorUsingDatabase(
    database,
    provider,
    trigger,
    requestedByEmail,
  );
}

export async function refreshConnectorUsingDatabase(
  database: D1Database,
  provider: ConnectorProvider,
  trigger: SyncTrigger,
  requestedByEmail: string | null,
): Promise<RefreshResult> {
  // Historical sync rows may contain the retired automatic trigger values,
  // but provider collection reads are owner-triggered only. Keeping this
  // runtime guard prevents a stale caller from issuing a provider request.
  if (trigger !== "manual") {
    return { status: "not_due", provider };
  }

  if (provider === "steam" && !steamStorageCountries()) {
    return {
      status: "setup_required",
      provider,
      reason: "storage_disclosure",
    };
  }

  if (provider === "discogs") {
    try {
      const notBefore = await discogsRetryNotBefore(database);
      if (notBefore) {
        return {
          status: "failed",
          provider,
          code: "rate_limited",
          retryable: true,
          retryNotBefore: notBefore,
        };
      }
    } catch {
      return { status: "setup_required", provider, reason: "database" };
    }
  }

  if (provider === "discogs" && trigger === "manual") {
    try {
      const retryNotBefore = await discogsManualRefreshNotBefore(database);
      if (retryNotBefore) {
        return { status: "not_due", provider, retryNotBefore };
      }
    } catch {
      return { status: "setup_required", provider, reason: "database" };
    }
  }

  try {
    await pruneConnectorRetention(database);
  } catch {
    return { status: "setup_required", provider, reason: "database" };
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const staleLockBefore = new Date(
    Date.parse(startedAt) - RUN_LOCK_WINDOW_MS,
  ).toISOString();
  let lockResult: D1Result;
  try {
    const lockResults = await database.batch([
      database
        .prepare(
          `UPDATE sync_runs
           SET status = 'failed', finished_at = ?,
               error_code = 'stale_lock',
               error_message = 'An interrupted sync lock expired.'
           WHERE provider = ? AND status = 'running' AND started_at < ?`,
        )
        .bind(startedAt, provider, staleLockBefore),
      database
        .prepare(
          `INSERT OR IGNORE INTO sync_runs (
             id, provider, trigger, status, requested_by_email, started_at
           ) VALUES (?, ?, ?, 'running', ?, ?)`,
        )
        .bind(runId, provider, trigger, requestedByEmail, startedAt),
    ]);
    lockResult = lockResults[1];
  } catch {
    return { status: "setup_required", provider, reason: "database" };
  }

  if ((lockResult.meta.changes ?? 0) !== 1) {
    return { status: "already_running", provider };
  }

  let activeCredentialGeneration: number | null = null;

  try {
    const loadedCredential = await loadCredential(database, provider);
    if (!loadedCredential) {
      const finishedAt = new Date().toISOString();
      await database
        .prepare(
          `UPDATE sync_runs
           SET status = 'failed', finished_at = ?,
               error_code = 'credential_missing',
               error_message = 'Connector credential is not configured.'
           WHERE id = ?`,
        )
        .bind(finishedAt, runId)
        .run();
      return { status: "setup_required", provider, reason: "credential" };
    }
    activeCredentialGeneration = loadedCredential.generation;

    const result = await fetchConnectorSnapshot(
      database,
      provider,
      loadedCredential.credential,
      loadedCredential.generation,
    );
    const fetchedAt = new Date().toISOString();
    const freshUntil = new Date(
      Date.parse(fetchedAt) + freshnessWindow(provider),
    ).toISOString();
    const snapshotId = crypto.randomUUID();
    const publicPayload = {
      ...result.publicPayload,
      syncedAt: fetchedAt,
      freshUntil,
    };
    if (!validateConnectorPublicPayload(provider, publicPayload)) {
      throw new ConnectorFetchError(
        "Provider output failed the public payload policy.",
        { code: "public_payload_rejected" },
      );
    }
    const publicPayloadJson = JSON.stringify(publicPayload);

    const completionResults = await database.batch([
      database
        .prepare(
          `INSERT INTO connector_snapshots (
             id, provider, status, public_payload_json, fetched_at,
             fresh_until, etag, item_count
           )
           SELECT ?, ?, 'ready', ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = ? AND generation = ?
           )
             AND EXISTS (
               SELECT 1 FROM sync_runs
               WHERE id = ? AND provider = ? AND status = 'running'
             )`,
        )
        .bind(
          snapshotId,
          provider,
          publicPayloadJson,
          fetchedAt,
          freshUntil,
          result.etag ?? null,
          result.itemCount,
          provider,
          loadedCredential.generation,
          runId,
          provider,
        ),
      database
        .prepare(
          `DELETE FROM connector_snapshots
           WHERE provider = ?
             AND EXISTS (
               SELECT 1 FROM connector_credentials
               WHERE provider = ? AND generation = ?
             )
             AND EXISTS (
               SELECT 1 FROM sync_runs
               WHERE id = ? AND provider = ? AND status = 'running'
             )
             AND id NOT IN (
               SELECT id
               FROM connector_snapshots
               WHERE provider = ?
               ORDER BY fetched_at DESC, id DESC
               LIMIT ${retainedSnapshotCount(provider)}
             )`,
        )
        .bind(
          provider,
          provider,
          loadedCredential.generation,
          runId,
          provider,
          provider,
        ),
      database
        .prepare(
          `UPDATE sync_runs
           SET status = 'complete', finished_at = ?, item_count = ?,
               http_status = 200, error_code = NULL, error_message = NULL
           WHERE id = ? AND provider = ? AND status = 'running'
             AND EXISTS (
               SELECT 1 FROM connector_credentials
               WHERE provider = ? AND generation = ?
             )`,
        )
        .bind(
          fetchedAt,
          result.itemCount,
          runId,
          provider,
          provider,
          loadedCredential.generation,
        ),
      database
        .prepare(
          `INSERT INTO audit_log (
             id, actor_email, action, entity_type, entity_id, details_json, created_at
           )
           SELECT ?, ?, 'connector.sync_completed', 'connector', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM sync_runs
             WHERE id = ? AND provider = ? AND status = 'complete'
           )`,
        )
        .bind(
          crypto.randomUUID(),
          requestedByEmail ?? "system",
          provider,
          JSON.stringify({ trigger, itemCount: result.itemCount }),
          fetchedAt,
          runId,
          provider,
        ),
    ]);
    if (
      (completionResults[0]?.meta.changes ?? 0) !== 1 ||
      (completionResults[2]?.meta.changes ?? 0) !== 1
    ) {
      throw new ConnectorFetchError(
        "The connector changed before its refresh could be finalized.",
        { code: "credential_changed", retryable: true },
      );
    }

    if (provider === "discogs") {
      await clearDiscogsRetry(database).catch(() => undefined);
    }

    return {
      status: "complete",
      provider,
      itemCount: result.itemCount,
      fetchedAt,
    };
  } catch (error) {
    const failure = safeError(error);
    const finishedAt = new Date().toISOString();
    let retryNotBefore: string | undefined;
    if (provider === "discogs" && failure.code === "rate_limited") {
      try {
        retryNotBefore = await recordDiscogsRetryAfter(
          database,
          failure.retryAfterSeconds ?? 3_600,
        );
      } catch {
        // The failed sync remains recorded below; a D1 outage also prevents
        // the scheduler from issuing a competing provider request.
      }
    }
    if (
      provider === "steam" &&
      failure.code === "visibility_unavailable" &&
      activeCredentialGeneration !== null
    ) {
      const tombstoneId = crypto.randomUUID();
      try {
        const withheldResults = await database.batch([
          database
            .prepare(
              `INSERT INTO connector_snapshots (
                 id, provider, status, public_payload_json, fetched_at,
                 fresh_until, etag, item_count
               )
               SELECT ?, ?, 'withheld', '{}', ?, ?, NULL, 0
               WHERE EXISTS (
                 SELECT 1 FROM connector_credentials
                 WHERE provider = ? AND generation = ?
               )
                 AND EXISTS (
                   SELECT 1 FROM sync_runs
                   WHERE id = ? AND provider = ? AND status = 'running'
                 )`,
            )
            .bind(
              tombstoneId,
              provider,
              finishedAt,
              finishedAt,
              provider,
              activeCredentialGeneration,
              runId,
              provider,
            ),
          database
            .prepare(
              `DELETE FROM connector_snapshots
               WHERE provider = ? AND id <> ?
                 AND EXISTS (
                   SELECT 1 FROM connector_credentials
                   WHERE provider = ? AND generation = ?
                 )
                 AND EXISTS (
                   SELECT 1 FROM sync_runs
                   WHERE id = ? AND provider = ? AND status = 'running'
                 )`,
            )
            .bind(
              provider,
              tombstoneId,
              provider,
              activeCredentialGeneration,
              runId,
              provider,
            ),
          database
            .prepare(
              `UPDATE sync_runs
               SET status = 'withheld', finished_at = ?, item_count = 0,
                   http_status = 200, error_code = 'visibility_unavailable',
                   error_message = 'Steam game details are not publicly visible.'
               WHERE id = ? AND provider = ? AND status = 'running'
                 AND EXISTS (
                   SELECT 1 FROM connector_credentials
                   WHERE provider = ? AND generation = ?
                 )`,
            )
            .bind(
              finishedAt,
              runId,
              provider,
              provider,
              activeCredentialGeneration,
            ),
          database
            .prepare(
              `DELETE FROM sync_runs
               WHERE provider = ? AND id <> ?
                 AND EXISTS (
                   SELECT 1 FROM connector_credentials
                   WHERE provider = ? AND generation = ?
                 )
                 AND EXISTS (
                   SELECT 1 FROM sync_runs
                   WHERE id = ? AND provider = ? AND status = 'withheld'
                 )`,
            )
            .bind(
              provider,
              runId,
              provider,
              activeCredentialGeneration,
              runId,
              provider,
            ),
          database
            .prepare(
              `DELETE FROM audit_log
               WHERE entity_type = 'connector' AND entity_id = ?
                 AND EXISTS (
                   SELECT 1 FROM connector_credentials
                   WHERE provider = ? AND generation = ?
                 )
                 AND EXISTS (
                   SELECT 1 FROM sync_runs
                   WHERE id = ? AND provider = ? AND status = 'withheld'
                 )`,
            )
            .bind(
              provider,
              provider,
              activeCredentialGeneration,
              runId,
              provider,
            ),
          database
            .prepare(
              `INSERT INTO audit_log (
                 id, actor_email, action, entity_type, entity_id, details_json, created_at
               )
               SELECT ?, ?, 'connector.visibility_withheld', 'connector', ?, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM sync_runs
                 WHERE id = ? AND provider = ? AND status = 'withheld'
               )`,
            )
            .bind(
              crypto.randomUUID(),
              requestedByEmail ?? "system",
              provider,
              JSON.stringify({ trigger }),
              finishedAt,
              runId,
              provider,
            ),
        ]);
        if (
          (withheldResults[0]?.meta.changes ?? 0) !== 1 ||
          (withheldResults[2]?.meta.changes ?? 0) !== 1
        ) {
          return {
            status: "failed",
            provider,
            code: "credential_changed",
            retryable: true,
          };
        }
        return {
          status: "withheld",
          provider,
          reason: "visibility_unavailable",
          fetchedAt: finishedAt,
        };
      } catch {
        // Fall through to the generic safe failure path if D1 becomes
        // unavailable while applying the privacy tombstone.
      }
    }
    if (failure.code !== "credential_changed") {
      try {
        const generationCondition =
          activeCredentialGeneration === null
            ? `provider = ?`
            : `provider = ? AND generation = ?`;
        const updateBindings =
          activeCredentialGeneration === null
            ? [
                finishedAt,
                failure.httpStatus,
                failure.code,
                failure.message,
                runId,
                provider,
                provider,
              ]
            : [
                finishedAt,
                failure.httpStatus,
                failure.code,
                failure.message,
                runId,
                provider,
                provider,
                activeCredentialGeneration,
              ];
        await database.batch([
          database
            .prepare(
              `UPDATE sync_runs
               SET status = 'failed', finished_at = ?, http_status = ?,
                   error_code = ?, error_message = ?
               WHERE id = ? AND provider = ? AND status = 'running'
                 AND EXISTS (
                   SELECT 1 FROM connector_credentials
                   WHERE ${generationCondition}
                 )`,
            )
            .bind(...updateBindings),
          database
            .prepare(
              `INSERT INTO audit_log (
                 id, actor_email, action, entity_type, entity_id, details_json, created_at
               )
               SELECT ?, ?, 'connector.sync_failed', 'connector', ?, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM sync_runs
                 WHERE id = ? AND provider = ? AND status = 'failed'
               )`,
            )
            .bind(
              crypto.randomUUID(),
              requestedByEmail ?? "system",
              provider,
              JSON.stringify({ trigger, code: failure.code }),
              finishedAt,
              runId,
              provider,
            ),
        ]);
      } catch {
        // The caller still receives a safe failure result if D1 becomes
        // unavailable while recording the provider failure.
      }
    }

    if (failure.code === "encryption_key_missing") {
      return {
        status: "setup_required",
        provider,
        reason: "encryption_key",
      };
    }

    return {
      status: "failed",
      provider,
      code: failure.code,
      retryable: failure.retryable,
      ...(retryNotBefore ? { retryNotBefore } : {}),
    };
  }
}
