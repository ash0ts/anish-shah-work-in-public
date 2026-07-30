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
  CONNECTOR_PROVIDERS,
  ConnectorFetchError,
  type ConnectorProvider,
  type HardcoverCredential,
  type MyAnimeListCredential,
  type SyncTrigger,
} from "./types";

const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;
const RUN_LOCK_WINDOW_MS = 10 * 60 * 1000;

export type ConnectorHealth = {
  provider: ConnectorProvider;
  configured: boolean;
  status:
    | "setup_required"
    | "never_synced"
    | "healthy"
    | "stale"
    | "syncing"
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
      status: "setup_required";
      provider: ConnectorProvider;
      reason: "database" | "credential" | "encryption_key";
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
          `SELECT fetched_at AS fetchedAt, fresh_until AS freshUntil,
                  item_count AS itemCount
           FROM connector_snapshots
           WHERE provider = ? AND status = 'ready'
           ORDER BY fetched_at DESC
           LIMIT 1`,
        )
        .bind(provider)
        .first<{
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
      if (!configured) status = "setup_required";
      else if (run?.status === "running") status = "syncing";
      else if (run?.status === "failed") status = "error";
      else if (snapshot && stale) status = "stale";
      else if (snapshot) status = "healthy";

      connectors.push({
        provider,
        configured,
        status,
        lastSyncedAt: snapshot?.fetchedAt ?? null,
        freshUntil: snapshot?.freshUntil ?? null,
        lastRunStatus: run?.status ?? null,
        lastErrorCode: run?.errorCode ?? null,
        itemCount: snapshot ? asCount(snapshot.itemCount) : null,
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
        `SELECT public_payload_json AS publicPayloadJson,
                fetched_at AS fetchedAt,
                fresh_until AS freshUntil
         FROM connector_snapshots
         WHERE provider = ? AND status = 'ready'
         ORDER BY fetched_at DESC
         LIMIT 25`,
      )
      .bind(provider)
      .all<{
        publicPayloadJson: string;
        fetchedAt: string;
        freshUntil: string;
      }>();

    for (const snapshot of snapshots.results ?? []) {
      const payload = parseStoredConnectorPublicPayload(
        provider,
        snapshot.publicPayloadJson,
      );
      if (!payload) continue;

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
  secret: string,
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

  const normalizedSecret =
    provider === "myanimelist"
      ? normalizeMyAnimeListAccessToken(secret)
      : secret.trim();
  if (!normalizedSecret) {
    return { status: "invalid", reason: "credential" };
  }
  const credential =
    provider === "myanimelist"
      ? { accessToken: normalizedSecret }
      : { authorization: normalizedSecret };
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
          : "Owner API authorization token",
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
    database
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, 'connector.credential_deleted', 'connector', ?, '{}', ?)`,
      )
      .bind(crypto.randomUUID(), actorEmail, provider, now),
  ]);
}

async function loadCredential(
  database: D1Database,
  provider: ConnectorProvider,
): Promise<MyAnimeListCredential | HardcoverCredential | null> {
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

  return decryptCredential<
    MyAnimeListCredential | HardcoverCredential
  >(row, encryptionKey, provider);
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

    const result =
      provider === "myanimelist"
        ? await fetchMyAnimeListSnapshot(credential as MyAnimeListCredential)
        : await fetchHardcoverSnapshot(credential as HardcoverCredential);
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
