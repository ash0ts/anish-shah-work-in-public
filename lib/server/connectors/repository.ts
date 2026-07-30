import { runtimeDatabase, runtimeValue } from "../runtime-env";
import {
  decryptCredential,
  encryptCredential,
  type EncryptedCredential,
} from "../credential-crypto";
import { classifyDatabaseError } from "../database-errors";
import { fetchHardcoverSnapshot } from "./hardcover";
import {
  fetchMyAnimeListSnapshot,
  normalizeMyAnimeListAccessToken,
} from "./myanimelist";
import {
  parseStoredConnectorPublicPayload,
  validateConnectorPublicPayload,
} from "./public-payload-policy";
import {
  fetchSteamSnapshot,
  normalizeSteamApiKey,
  normalizeSteamId,
} from "./steam";
import { steamStorageCountries } from "./steam-policy";
import {
  CONNECTOR_PROVIDERS,
  ConnectorFetchError,
  type ConnectorCredential,
  type ConnectorCredentialInput,
  type ConnectorFetchResult,
  type ConnectorProvider,
  type HardcoverCredential,
  type MyAnimeListCredential,
  type SteamCredential,
  type SyncTrigger,
} from "./types";

const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;
const RUN_LOCK_WINDOW_MS = 10 * 60 * 1000;
const STEAM_MAX_PUBLIC_AGE_MS = 72 * 60 * 60 * 1000;

export type ConnectorHealth = {
  provider: ConnectorProvider;
  configured: boolean;
  status:
    | "setup_required"
    | "never_synced"
    | "healthy"
    | "stale"
    | "syncing"
    | "visibility_required"
    | "error";
  lastSyncedAt: string | null;
  freshUntil: string | null;
  lastRunStatus: string | null;
  lastErrorCode: string | null;
  itemCount: number | null;
};

export type StudioOverview =
  | {
      status: "ready";
      encryptionConfigured: boolean;
      steamStorageCountries: string | null;
      publicationCounts: Record<string, number>;
      connectors: ConnectorHealth[];
      latestPublication: {
        id: string;
        contentHash: string;
        recordCount: number;
        publishedAt: string;
      } | null;
    }
  | {
      status: "database_setup_required";
      reason: "binding_unavailable" | "schema_unavailable" | "database_error";
      encryptionConfigured: boolean;
      steamStorageCountries: string | null;
      connectors: ConnectorHealth[];
    };

export type PublicSnapshotResult =
  | {
      status: "ready";
      provider: ConnectorProvider;
      payload: Record<string, unknown>;
      fetchedAt: string;
      freshUntil: string;
      stale: boolean;
    }
  | {
      status: "unavailable";
      provider: ConnectorProvider;
      reason:
        | "not_configured"
        | "never_synced"
        | "invalid_snapshot"
        | "visibility_withheld"
        | "stale_expired"
        | "database_unavailable";
    };

export type RefreshResult =
  | {
      status: "complete";
      provider: ConnectorProvider;
      itemCount: number;
      fetchedAt: string;
    }
  | {
      status: "already_running";
      provider: ConnectorProvider;
    }
  | {
      status: "not_due";
      provider: ConnectorProvider;
    }
  | {
      status: "withheld";
      provider: "steam";
      reason: "visibility_unavailable";
      fetchedAt: string;
    }
  | {
      status: "setup_required";
      provider: ConnectorProvider;
      reason:
        | "database"
        | "credential"
        | "encryption_key"
        | "storage_disclosure";
    }
  | {
      status: "failed";
      provider: ConnectorProvider;
      code: string;
      retryable: boolean;
    };

function databaseOrNull(): D1Database | null {
  return runtimeDatabase();
}

function placeholderHealth(provider: ConnectorProvider): ConnectorHealth {
  return {
    provider,
    configured: false,
    status: "setup_required",
    lastSyncedAt: null,
    freshUntil: null,
    lastRunStatus: null,
    lastErrorCode: null,
    itemCount: null,
  };
}

function asCount(value: unknown): number {
  return typeof value === "number" ? value : Number(value) || 0;
}

export async function getStudioOverview(): Promise<StudioOverview> {
  const database = databaseOrNull();
  if (!database) {
    return {
      status: "database_setup_required",
      reason: "binding_unavailable",
      encryptionConfigured: Boolean(runtimeValue("CONNECTOR_ENCRYPTION_KEY")),
      steamStorageCountries: steamStorageCountries(),
      connectors: CONNECTOR_PROVIDERS.map(placeholderHealth),
    };
  }

  try {
    const publicationRows = await database
      .prepare(
        `SELECT publication_state AS publicationState, COUNT(*) AS count
         FROM public_records
         GROUP BY publication_state`,
      )
      .all<{ publicationState: string; count: number }>();

    const publicationCounts = Object.fromEntries(
      (publicationRows.results ?? []).map((row) => [
        row.publicationState,
        asCount(row.count),
      ]),
    );

    const connectors: ConnectorHealth[] = [];
    for (const provider of CONNECTOR_PROVIDERS) {
      const credential = await database
        .prepare(
          `SELECT provider
           FROM connector_credentials
           WHERE provider = ?
           LIMIT 1`,
        )
        .bind(provider)
        .first<{ provider: string }>();
      const snapshot = await database
        .prepare(
          `SELECT status, fetched_at AS fetchedAt, fresh_until AS freshUntil,
                  item_count AS itemCount
           FROM connector_snapshots
           WHERE provider = ?
           ORDER BY fetched_at DESC
           LIMIT 1`,
        )
        .bind(provider)
        .first<{
          status: string;
          fetchedAt: string;
          freshUntil: string;
          itemCount: number;
        }>();
      const run = await database
        .prepare(
          `SELECT status, error_code AS errorCode
           FROM sync_runs
           WHERE provider = ?
           ORDER BY started_at DESC
           LIMIT 1`,
        )
        .bind(provider)
        .first<{ status: string; errorCode: string | null }>();

      const configured = Boolean(credential);
      const stale = snapshot
        ? Date.parse(snapshot.freshUntil) <= Date.now()
        : false;
      let status: ConnectorHealth["status"] = "never_synced";
      if (provider === "steam" && !steamStorageCountries()) {
        status = "setup_required";
      } else if (!configured) status = "setup_required";
      else if (run?.status === "running") status = "syncing";
      else if (
        provider === "steam" &&
        (snapshot?.status === "withheld" || run?.status === "withheld")
      ) {
        status = "visibility_required";
      } else if (run?.status === "failed") status = "error";
      else if (snapshot?.status === "ready" && stale) status = "stale";
      else if (snapshot?.status === "ready") status = "healthy";

      connectors.push({
        provider,
        configured,
        status,
        lastSyncedAt: snapshot?.fetchedAt ?? null,
        freshUntil: snapshot?.freshUntil ?? null,
        lastRunStatus: run?.status ?? null,
        lastErrorCode: run?.errorCode ?? null,
        itemCount:
          snapshot?.status === "ready" ? asCount(snapshot.itemCount) : null,
      });
    }

    const latestPublication = await database
      .prepare(
        `SELECT id, content_hash AS contentHash, record_count AS recordCount,
                created_at AS publishedAt
         FROM publication_snapshots
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .first<{
        id: string;
        contentHash: string;
        recordCount: number;
        publishedAt: string;
      }>();

    return {
      status: "ready",
      encryptionConfigured: Boolean(runtimeValue("CONNECTOR_ENCRYPTION_KEY")),
      steamStorageCountries: steamStorageCountries(),
      publicationCounts,
      connectors,
      latestPublication: latestPublication
        ? {
            ...latestPublication,
            recordCount: asCount(latestPublication.recordCount),
          }
        : null,
    };
  } catch (error) {
    return {
      status: "database_setup_required",
      reason: classifyDatabaseError(error),
      encryptionConfigured: Boolean(runtimeValue("CONNECTOR_ENCRYPTION_KEY")),
      steamStorageCountries: steamStorageCountries(),
      connectors: CONNECTOR_PROVIDERS.map(placeholderHealth),
    };
  }
}

export async function getPublicConnectorSnapshot(
  provider: ConnectorProvider,
): Promise<PublicSnapshotResult> {
  const database = databaseOrNull();
  if (!database) {
    return { status: "unavailable", provider, reason: "database_unavailable" };
  }

  try {
    const snapshots = await database
      .prepare(
        `SELECT status, public_payload_json AS publicPayloadJson,
                fetched_at AS fetchedAt,
                fresh_until AS freshUntil
         FROM connector_snapshots
         WHERE provider = ?
         ORDER BY fetched_at DESC
         LIMIT 25`,
      )
      .bind(provider)
      .all<{
        status: string;
        publicPayloadJson: string;
        fetchedAt: string;
        freshUntil: string;
      }>();

    for (const snapshot of snapshots.results ?? []) {
      if (provider === "steam" && snapshot.status === "withheld") {
        return {
          status: "unavailable",
          provider,
          reason: "visibility_withheld",
        };
      }
      if (snapshot.status !== "ready") continue;

      const payload = parseStoredConnectorPublicPayload(
        provider,
        snapshot.publicPayloadJson,
      );
      if (!payload) continue;
      if (provider === "steam") {
        const fetchedTime = Date.parse(snapshot.fetchedAt);
        if (
          !Number.isFinite(fetchedTime) ||
          Date.now() - fetchedTime > STEAM_MAX_PUBLIC_AGE_MS
        ) {
          return {
            status: "unavailable",
            provider,
            reason: "stale_expired",
          };
        }
      }

      return {
        status: "ready",
        provider,
        payload,
        fetchedAt: snapshot.fetchedAt,
        freshUntil: snapshot.freshUntil,
        stale: Date.parse(snapshot.freshUntil) <= Date.now(),
      };
    }

    if ((snapshots.results?.length ?? 0) === 0) {
      const credential = await database
        .prepare(
          `SELECT provider
           FROM connector_credentials
           WHERE provider = ?
           LIMIT 1`,
        )
        .bind(provider)
        .first();
      return {
        status: "unavailable",
        provider,
        reason: credential ? "never_synced" : "not_configured",
      };
    }

    return {
      status: "unavailable",
      provider,
      reason: "invalid_snapshot",
    };
  } catch {
    return { status: "unavailable", provider, reason: "database_unavailable" };
  }
}

export async function saveConnectorCredential(
  provider: ConnectorProvider,
  input: ConnectorCredentialInput,
  actorEmail: string,
): Promise<
  | { status: "saved" }
  | { status: "invalid"; reason: "credential" }
  | { status: "setup_required"; reason: string }
> {
  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!database) {
    return { status: "setup_required", reason: "database" };
  }
  if (!encryptionKey) {
    return { status: "setup_required", reason: "encryption_key" };
  }
  if (provider === "steam" && !steamStorageCountries()) {
    return { status: "setup_required", reason: "storage_disclosure" };
  }

  let credential: ConnectorCredential | null = null;
  if (provider === "myanimelist" && typeof input === "string") {
    const accessToken = normalizeMyAnimeListAccessToken(input);
    if (accessToken) credential = { accessToken };
  } else if (provider === "hardcover" && typeof input === "string") {
    const authorization = input.trim();
    if (authorization) credential = { authorization };
  } else if (
    provider === "steam" &&
    typeof input === "object" &&
    input !== null
  ) {
    const apiKey = normalizeSteamApiKey(input.apiKey);
    const steamId = normalizeSteamId(input.steamId);
    if (apiKey && steamId) credential = { apiKey, steamId };
  }
  if (!credential) {
    return { status: "invalid", reason: "credential" };
  }
  let encrypted: EncryptedCredential;
  try {
    encrypted = await encryptCredential(credential, encryptionKey, provider);
  } catch {
    return { status: "setup_required", reason: "encryption_key" };
  }
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  await database.batch([
    database
      .prepare(
        `INSERT INTO connector_credentials (
           provider, ciphertext, iv, key_version, credential_label,
           scopes_json, expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           key_version = excluded.key_version,
           credential_label = excluded.credential_label,
           scopes_json = excluded.scopes_json,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        provider,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.keyVersion,
        provider === "myanimelist"
          ? "Owner OAuth access token"
          : provider === "hardcover"
            ? "Owner API authorization token"
            : "Owner Web API key and SteamID64",
        "[]",
        now,
        now,
      ),
    database
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, 'connector.credential_saved', 'connector', ?, '{}', ?)`,
      )
      .bind(auditId, actorEmail, provider, now),
  ]);

  return { status: "saved" };
}

export async function deleteConnectorCredential(
  provider: ConnectorProvider,
  actorEmail: string,
): Promise<void> {
  const database = databaseOrNull();
  if (!database) throw new Error("D1 database binding is unavailable.");
  const now = new Date().toISOString();

  await database.batch([
    database
      .prepare(`DELETE FROM connector_credentials WHERE provider = ?`)
      .bind(provider),
    ...(provider === "steam"
      ? [
          database
            .prepare(`DELETE FROM connector_snapshots WHERE provider = ?`)
            .bind(provider),
          database
            .prepare(`DELETE FROM sync_runs WHERE provider = ?`)
            .bind(provider),
          database
            .prepare(
              `DELETE FROM audit_log
               WHERE entity_type = 'connector' AND entity_id = ?`,
            )
            .bind(provider),
        ]
      : []),
    database
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, 'connector.credential_deleted', 'connector', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        provider,
        JSON.stringify({
          snapshotsDeleted: provider === "steam",
          syncHistoryDeleted: provider === "steam",
        }),
        now,
      ),
  ]);
}

async function loadCredential(
  database: D1Database,
  provider: ConnectorProvider,
): Promise<ConnectorCredential | null> {
  const row = await database
    .prepare(
      `SELECT ciphertext, iv, key_version AS keyVersion
       FROM connector_credentials
       WHERE provider = ?
       LIMIT 1`,
    )
    .bind(provider)
    .first<EncryptedCredential>();
  if (!row) return null;

  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!encryptionKey) {
    throw new ConnectorFetchError(
      "Connector encryption is not configured.",
      { code: "encryption_key_missing" },
    );
  }

  return decryptCredential<ConnectorCredential>(
    row,
    encryptionKey,
    provider,
  );
}

async function fetchConnectorSnapshot(
  provider: ConnectorProvider,
  credential: ConnectorCredential,
): Promise<ConnectorFetchResult> {
  switch (provider) {
    case "myanimelist":
      return fetchMyAnimeListSnapshot(
        credential as MyAnimeListCredential,
      );
    case "hardcover":
      return fetchHardcoverSnapshot(credential as HardcoverCredential);
    case "steam":
      return fetchSteamSnapshot(credential as SteamCredential);
  }
}

function safeError(error: unknown): {
  code: string;
  message: string;
  httpStatus: number | null;
  retryable: boolean;
} {
  if (error instanceof ConnectorFetchError) {
    return {
      code: error.code,
      message: error.message,
      httpStatus: error.httpStatus,
      retryable: error.retryable,
    };
  }

  const databaseFailure = classifyDatabaseError(error);
  if (databaseFailure !== "database_error") {
    return {
      code: databaseFailure,
      message: "Connector persistence is not ready.",
      httpStatus: null,
      retryable: false,
    };
  }

  return {
    code: "sync_failed",
    message: "The connector sync failed before a new snapshot was saved.",
    httpStatus: null,
    retryable: true,
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
  if (provider === "steam" && !steamStorageCountries()) {
    return {
      status: "setup_required",
      provider,
      reason: "storage_disclosure",
    };
  }

  if (trigger === "stale_revalidate") {
    try {
      const latestAutomaticRun = await database
        .prepare(
          `SELECT started_at AS startedAt
           FROM sync_runs
           WHERE provider = ? AND trigger = 'stale_revalidate'
           ORDER BY started_at DESC
           LIMIT 1`,
        )
        .bind(provider)
        .first<{ startedAt: string }>();
      if (
        latestAutomaticRun &&
        Date.now() - Date.parse(latestAutomaticRun.startedAt) <
          FRESHNESS_WINDOW_MS
      ) {
        return { status: "not_due", provider };
      }
    } catch {
      return { status: "setup_required", provider, reason: "database" };
    }
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

  try {
    const credential = await loadCredential(database, provider);
    if (!credential) {
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

    const result = await fetchConnectorSnapshot(provider, credential);
    const fetchedAt = new Date().toISOString();
    const freshUntil = new Date(
      Date.parse(fetchedAt) + FRESHNESS_WINDOW_MS,
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

    await database.batch([
      database
        .prepare(
          `INSERT INTO connector_snapshots (
             id, provider, status, public_payload_json, fetched_at,
             fresh_until, etag, item_count
           ) VALUES (?, ?, 'ready', ?, ?, ?, ?, ?)`,
        )
        .bind(
          snapshotId,
          provider,
          publicPayloadJson,
          fetchedAt,
          freshUntil,
          result.etag ?? null,
          result.itemCount,
        ),
      ...(provider === "steam"
        ? [
            database
              .prepare(
                `DELETE FROM connector_snapshots
                 WHERE provider = ?
                   AND id NOT IN (
                     SELECT id
                     FROM connector_snapshots
                     WHERE provider = ?
                     ORDER BY fetched_at DESC, id DESC
                     LIMIT 2
                   )`,
              )
              .bind(provider, provider),
          ]
        : []),
      database
        .prepare(
          `UPDATE sync_runs
           SET status = 'complete', finished_at = ?, item_count = ?,
               http_status = 200, error_code = NULL, error_message = NULL
           WHERE id = ?`,
        )
        .bind(fetchedAt, result.itemCount, runId),
      database
        .prepare(
          `INSERT INTO audit_log (
             id, actor_email, action, entity_type, entity_id, details_json, created_at
           ) VALUES (?, ?, 'connector.sync_completed', 'connector', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          requestedByEmail ?? "system",
          provider,
          JSON.stringify({ trigger, itemCount: result.itemCount }),
          fetchedAt,
        ),
    ]);

    return {
      status: "complete",
      provider,
      itemCount: result.itemCount,
      fetchedAt,
    };
  } catch (error) {
    const failure = safeError(error);
    const finishedAt = new Date().toISOString();
    if (provider === "steam" && failure.code === "visibility_unavailable") {
      const tombstoneId = crypto.randomUUID();
      try {
        await database.batch([
          database
            .prepare(
              `INSERT INTO connector_snapshots (
                 id, provider, status, public_payload_json, fetched_at,
                 fresh_until, etag, item_count
               ) VALUES (?, ?, 'withheld', '{}', ?, ?, NULL, 0)`,
            )
            .bind(
              tombstoneId,
              provider,
              finishedAt,
              finishedAt,
            ),
          database
            .prepare(
              `DELETE FROM connector_snapshots
               WHERE provider = ? AND id <> ?`,
            )
            .bind(provider, tombstoneId),
          database
            .prepare(
              `UPDATE sync_runs
               SET status = 'withheld', finished_at = ?, item_count = 0,
                   http_status = 200, error_code = 'visibility_unavailable',
                   error_message = 'Steam game details are not publicly visible.'
               WHERE id = ?`,
            )
            .bind(finishedAt, runId),
          database
            .prepare(
              `DELETE FROM sync_runs
               WHERE provider = ? AND id <> ?`,
            )
            .bind(provider, runId),
          database
            .prepare(
              `DELETE FROM audit_log
               WHERE entity_type = 'connector' AND entity_id = ?`,
            )
            .bind(provider),
          database
            .prepare(
              `INSERT INTO audit_log (
                 id, actor_email, action, entity_type, entity_id, details_json, created_at
               ) VALUES (?, ?, 'connector.visibility_withheld', 'connector', ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              requestedByEmail ?? "system",
              provider,
              JSON.stringify({ trigger }),
              finishedAt,
            ),
        ]);
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
    try {
      await database.batch([
        database
          .prepare(
            `UPDATE sync_runs
             SET status = 'failed', finished_at = ?, http_status = ?,
                 error_code = ?, error_message = ?
             WHERE id = ?`,
          )
          .bind(
            finishedAt,
            failure.httpStatus,
            failure.code,
            failure.message,
            runId,
          ),
        database
          .prepare(
            `INSERT INTO audit_log (
               id, actor_email, action, entity_type, entity_id, details_json, created_at
             ) VALUES (?, ?, 'connector.sync_failed', 'connector', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            requestedByEmail ?? "system",
            provider,
            JSON.stringify({ trigger, code: failure.code }),
            finishedAt,
          ),
      ]);
    } catch {
      // The caller still receives a safe failure result if D1 becomes
      // unavailable while recording the provider failure.
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
    };
  }
}
