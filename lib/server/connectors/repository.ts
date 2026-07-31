import { runtimeDatabase, runtimeValue } from "../runtime-env";
import {
  decryptCredential,
  encryptCredential,
  type EncryptedCredential,
} from "../credential-crypto";
import { classifyDatabaseError } from "../database-errors";
import {
  fetchHardcoverSnapshot,
  normalizeHardcoverAuthorization,
} from "./hardcover";
import {
  fetchMyAnimeListSnapshot,
  normalizeMyAnimeListAccessToken,
} from "./myanimelist";
import {
  buildMyAnimeListAuthorizationUrl,
  createMyAnimeListOAuthState,
  createMyAnimeListPkceVerifier,
  exchangeMyAnimeListAuthorizationCode,
  hashMyAnimeListOAuthState,
  isMyAnimeListOAuthCredential,
  isValidMyAnimeListOAuthState,
  normalizeMyAnimeListOAuthClient,
  refreshMyAnimeListOAuthCredential,
  resolveMyAnimeListCallbackUrl,
  shouldRefreshMyAnimeListToken,
  type MyAnimeListOAuthClient,
  type MyAnimeListOAuthTransactionPayload,
} from "./myanimelist-oauth";
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
  type MyAnimeListOAuthCredential,
  type SteamCredential,
  type SyncTrigger,
} from "./types";

const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;
const RUN_LOCK_WINDOW_MS = 10 * 60 * 1000;
const STEAM_MAX_PUBLIC_AGE_MS = 72 * 60 * 60 * 1000;
const OAUTH_TRANSACTION_WINDOW_MS = 10 * 60 * 1000;
const MYANIMELIST_OAUTH_TRANSACTION_CONTEXT =
  "myanimelist-oauth-transaction";

export type ConnectorHealth = {
  provider: ConnectorProvider;
  configured: boolean;
  status:
    | "setup_required"
    | "authorization_required"
    | "reauthorization_required"
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

export type MyAnimeListOAuthStartResult =
  | {
      status: "authorization_required";
      provider: "myanimelist";
      authorizationUrl: string;
      callbackUrl: string;
      expiresAt: string;
    }
  | {
      status: "invalid";
      reason: "credential";
    }
  | {
      status: "setup_required";
      reason: "database" | "encryption_key" | "callback_url";
    };

export type MyAnimeListOAuthStageResult =
  | { status: "ready"; resumeState: string }
  | {
      status:
        | "expired"
        | "invalid_state"
        | "setup_required";
    };

export type MyAnimeListOAuthCompletionResult =
  | { status: "connected" }
  | {
      status:
        | "denied"
        | "expired"
        | "invalid_state"
        | "token_exchange_failed"
        | "setup_required";
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
          `SELECT provider, updated_at AS updatedAt
           FROM connector_credentials
           WHERE provider = ?
           LIMIT 1`,
        )
        .bind(provider)
        .first<{ provider: string; updatedAt: string }>();
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
          `SELECT status, error_code AS errorCode, started_at AS startedAt
           FROM sync_runs
           WHERE provider = ?
           ORDER BY started_at DESC
           LIMIT 1`,
        )
        .bind(provider)
        .first<{
          status: string;
          errorCode: string | null;
          startedAt: string;
        }>();
      const pendingAuthorization =
        provider === "myanimelist"
          ? await database
              .prepare(
                `SELECT state_hash AS stateHash
                 FROM connector_oauth_transactions
                 WHERE provider = 'myanimelist'
                   AND consumed_at IS NULL
                   AND expires_at > ?
                 LIMIT 1`,
              )
              .bind(new Date().toISOString())
              .first<{ stateHash: string }>()
          : null;

      const configured = Boolean(credential);
      const stale = snapshot
        ? Date.parse(snapshot.freshUntil) <= Date.now()
        : false;
      let status: ConnectorHealth["status"] = "never_synced";
      if (provider === "steam" && !steamStorageCountries()) {
        status = "setup_required";
      } else if (!configured && pendingAuthorization) {
        status = "authorization_required";
      } else if (!configured) status = "setup_required";
      else if (run?.status === "running") status = "syncing";
      else if (
        provider === "steam" &&
        (snapshot?.status === "withheld" || run?.status === "withheld")
      ) {
        status = "visibility_required";
      } else if (
        run?.status === "failed" &&
        run.errorCode === "reauthorization_required" &&
        (!credential?.updatedAt ||
          !run.startedAt ||
          Date.parse(run.startedAt) >= Date.parse(credential.updatedAt))
      ) {
        status = "reauthorization_required";
      } else if (
        run?.status === "failed" &&
        (!credential?.updatedAt ||
          !run.startedAt ||
          Date.parse(run.startedAt) >= Date.parse(credential.updatedAt))
      ) {
        status = "error";
      }
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

type StoredOAuthTransaction = EncryptedCredential & {
  stateHash: string;
  ownerEmail: string;
  redirectUri: string;
  expiresAt: string;
  consumedAt: string | null;
};

function myAnimeListCallbackUrl(requestUrl: string): string | null {
  return resolveMyAnimeListCallbackUrl(
    requestUrl,
    runtimeValue("SITE_URL"),
    runtimeValue("NODE_ENV") ?? process.env.NODE_ENV,
  );
}

function normalizedOwnerEmail(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function validAuthorizationCode(value: string | undefined): string | null {
  const candidate = value?.trim() ?? "";
  if (
    candidate.length < 8 ||
    candidate.length > 8192 ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function validProviderOAuthError(value: string | undefined): string | null {
  const candidate = value?.trim() ?? "";
  return /^[a-z0-9_]{1,64}$/i.test(candidate) ? candidate : null;
}

async function storedOAuthTransaction(
  database: D1Database,
  stateHash: string,
): Promise<StoredOAuthTransaction | null> {
  return database
    .prepare(
      `SELECT state_hash AS stateHash, ciphertext, iv,
              key_version AS keyVersion, owner_email AS ownerEmail,
              redirect_uri AS redirectUri, expires_at AS expiresAt,
              consumed_at AS consumedAt
       FROM connector_oauth_transactions
       WHERE state_hash = ? AND provider = 'myanimelist'
       LIMIT 1`,
    )
    .bind(stateHash)
    .first<StoredOAuthTransaction>();
}

async function decryptOAuthTransaction(
  row: StoredOAuthTransaction,
  encryptionKey: string,
): Promise<MyAnimeListOAuthTransactionPayload | null> {
  try {
    return await decryptCredential<MyAnimeListOAuthTransactionPayload>(
      row,
      encryptionKey,
      MYANIMELIST_OAUTH_TRANSACTION_CONTEXT,
    );
  } catch {
    return null;
  }
}

export async function startMyAnimeListOAuth(input: {
  clientId?: string;
  clientSecret?: string;
  actorEmail: string;
  requestUrl: string;
}): Promise<MyAnimeListOAuthStartResult> {
  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!database) return { status: "setup_required", reason: "database" };
  if (!encryptionKey) {
    return { status: "setup_required", reason: "encryption_key" };
  }
  const callbackUrl = myAnimeListCallbackUrl(input.requestUrl);
  if (!callbackUrl) {
    return { status: "setup_required", reason: "callback_url" };
  }

  let client: MyAnimeListOAuthClient | null = null;
  if (input.clientId !== undefined || input.clientSecret !== undefined) {
    client = normalizeMyAnimeListOAuthClient(
      input.clientId ?? "",
      input.clientSecret ?? "",
    );
  } else {
    try {
      const existing = await loadCredential(database, "myanimelist");
      if (isMyAnimeListOAuthCredential(existing)) {
        client = {
          clientId: existing.clientId,
          clientSecret: existing.clientSecret,
        };
      }
    } catch {
      return { status: "setup_required", reason: "encryption_key" };
    }
  }
  if (!client) return { status: "invalid", reason: "credential" };

  const state = createMyAnimeListOAuthState();
  const stateHash = await hashMyAnimeListOAuthState(state);
  const codeVerifier = createMyAnimeListPkceVerifier();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + OAUTH_TRANSACTION_WINDOW_MS,
  ).toISOString();
  let encrypted: EncryptedCredential;
  try {
    encrypted = await encryptCredential(
      {
        phase: "authorization",
        ...client,
        codeVerifier,
        callbackUrl,
      } satisfies MyAnimeListOAuthTransactionPayload,
      encryptionKey,
      MYANIMELIST_OAUTH_TRANSACTION_CONTEXT,
    );
  } catch {
    return { status: "setup_required", reason: "encryption_key" };
  }

  const ownerEmail = normalizedOwnerEmail(input.actorEmail);
  try {
    await database.batch([
      database
        .prepare(
          `DELETE FROM connector_oauth_transactions
           WHERE consumed_at IS NOT NULL OR expires_at <= ?`,
        )
        .bind(createdAt),
      database
        .prepare(
          `DELETE FROM connector_oauth_transactions
           WHERE provider = 'myanimelist' AND owner_email = ?`,
        )
        .bind(ownerEmail),
      database
        .prepare(
          `INSERT INTO connector_oauth_transactions (
             state_hash, provider, ciphertext, iv, key_version, owner_email,
             redirect_uri, expires_at, consumed_at, created_at
           ) VALUES (?, 'myanimelist', ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .bind(
          stateHash,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.keyVersion,
          ownerEmail,
          callbackUrl,
          expiresAt,
          createdAt,
        ),
    ]);
  } catch {
    return { status: "setup_required", reason: "database" };
  }

  return {
    status: "authorization_required",
    provider: "myanimelist",
    authorizationUrl: buildMyAnimeListAuthorizationUrl({
      clientId: client.clientId,
      codeVerifier,
      state,
    }),
    callbackUrl,
    expiresAt,
  };
}

/**
 * The provider callback can arrive after the SIWC session expires. Stow the
 * authorization code inside the already owner-bound encrypted transaction,
 * rotate the public state, and send only the fresh resume state through the
 * sign-in redirect.
 */
export async function stageMyAnimeListOAuthCallback(input: {
  state: string;
  authorizationCode?: string;
  providerError?: string;
  requestUrl: string;
}): Promise<MyAnimeListOAuthStageResult> {
  if (!isValidMyAnimeListOAuthState(input.state)) {
    return { status: "invalid_state" };
  }
  const authorizationCode = validAuthorizationCode(input.authorizationCode);
  const providerError = validProviderOAuthError(input.providerError);
  if (!authorizationCode && !providerError) {
    return { status: "invalid_state" };
  }

  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  const callbackUrl = myAnimeListCallbackUrl(input.requestUrl);
  if (!database || !encryptionKey || !callbackUrl) {
    return { status: "setup_required" };
  }

  const stateHash = await hashMyAnimeListOAuthState(input.state);
  let row: StoredOAuthTransaction | null;
  try {
    row = await storedOAuthTransaction(database, stateHash);
  } catch {
    return { status: "setup_required" };
  }
  if (!row || row.consumedAt) return { status: "invalid_state" };
  if (Date.parse(row.expiresAt) <= Date.now()) return { status: "expired" };
  if (row.redirectUri !== callbackUrl) return { status: "invalid_state" };

  const transaction = await decryptOAuthTransaction(row, encryptionKey);
  if (
    !transaction ||
    transaction.phase !== "authorization" ||
    transaction.callbackUrl !== callbackUrl
  ) {
    return { status: "invalid_state" };
  }

  const resumeState = createMyAnimeListOAuthState();
  const resumeStateHash = await hashMyAnimeListOAuthState(resumeState);
  let encrypted: EncryptedCredential;
  try {
    encrypted = await encryptCredential(
      {
        ...transaction,
        phase: "callback",
        ...(authorizationCode ? { authorizationCode } : {}),
        ...(providerError ? { providerError } : {}),
      } satisfies MyAnimeListOAuthTransactionPayload,
      encryptionKey,
      MYANIMELIST_OAUTH_TRANSACTION_CONTEXT,
    );
  } catch {
    return { status: "setup_required" };
  }

  try {
    const result = await database
      .prepare(
        `UPDATE connector_oauth_transactions
         SET state_hash = ?, ciphertext = ?, iv = ?, key_version = ?
         WHERE state_hash = ? AND provider = 'myanimelist'
           AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(
        resumeStateHash,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.keyVersion,
        stateHash,
        new Date().toISOString(),
      )
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      return { status: "invalid_state" };
    }
  } catch {
    return { status: "setup_required" };
  }

  return { status: "ready", resumeState };
}

async function saveMyAnimeListOAuthCredential(
  database: D1Database,
  credential: MyAnimeListOAuthCredential,
  actorEmail: string,
): Promise<void> {
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!encryptionKey) throw new Error("Connector encryption is unavailable.");
  const encrypted = await encryptCredential(
    credential,
    encryptionKey,
    "myanimelist",
  );
  const now = new Date().toISOString();
  const ownerEmail = normalizedOwnerEmail(actorEmail);
  await database.batch([
    database
      .prepare(
        `INSERT INTO connector_credentials (
           provider, ciphertext, iv, key_version, credential_label,
           scopes_json, expires_at, created_at, updated_at
         ) VALUES ('myanimelist', ?, ?, ?, ?, '[]', ?, ?, ?)
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
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.keyVersion,
        "Owner OAuth authorization",
        credential.accessTokenExpiresAt,
        now,
        now,
      ),
    database
      .prepare(
        `DELETE FROM connector_oauth_transactions
         WHERE provider = 'myanimelist' AND owner_email = ?`,
      )
      .bind(ownerEmail),
    database
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, 'connector.oauth_connected', 'connector',
                   'myanimelist', '{}', ?)`,
      )
      .bind(crypto.randomUUID(), actorEmail, now),
  ]);
}

export async function completeMyAnimeListOAuth(input: {
  resumeState: string;
  actorEmail: string;
  requestUrl: string;
}): Promise<MyAnimeListOAuthCompletionResult> {
  if (!isValidMyAnimeListOAuthState(input.resumeState)) {
    return { status: "invalid_state" };
  }
  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  const callbackUrl = myAnimeListCallbackUrl(input.requestUrl);
  if (!database || !encryptionKey || !callbackUrl) {
    return { status: "setup_required" };
  }

  const stateHash = await hashMyAnimeListOAuthState(input.resumeState);
  let row: StoredOAuthTransaction | null;
  try {
    row = await storedOAuthTransaction(database, stateHash);
  } catch {
    return { status: "setup_required" };
  }
  if (!row || row.consumedAt) return { status: "invalid_state" };
  if (Date.parse(row.expiresAt) <= Date.now()) return { status: "expired" };
  if (
    row.redirectUri !== callbackUrl ||
    normalizedOwnerEmail(row.ownerEmail) !==
      normalizedOwnerEmail(input.actorEmail)
  ) {
    return { status: "invalid_state" };
  }

  const transaction = await decryptOAuthTransaction(row, encryptionKey);
  if (
    !transaction ||
    transaction.phase !== "callback" ||
    transaction.callbackUrl !== callbackUrl
  ) {
    return { status: "invalid_state" };
  }

  try {
    const consumed = await database
      .prepare(
        `UPDATE connector_oauth_transactions
         SET consumed_at = ?
         WHERE state_hash = ? AND provider = 'myanimelist'
           AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(new Date().toISOString(), stateHash, new Date().toISOString())
      .run();
    if ((consumed.meta.changes ?? 0) !== 1) {
      return { status: "invalid_state" };
    }
  } catch {
    return { status: "setup_required" };
  }

  if (transaction.providerError) {
    return {
      status:
        transaction.providerError === "access_denied"
          ? "denied"
          : "token_exchange_failed",
    };
  }
  if (!transaction.authorizationCode) {
    return { status: "invalid_state" };
  }

  let credential: MyAnimeListOAuthCredential;
  try {
    credential = await exchangeMyAnimeListAuthorizationCode({
      clientId: transaction.clientId,
      clientSecret: transaction.clientSecret,
      authorizationCode: transaction.authorizationCode,
      codeVerifier: transaction.codeVerifier,
    });
    await saveMyAnimeListOAuthCredential(
      database,
      credential,
      input.actorEmail,
    );
  } catch {
    return { status: "token_exchange_failed" };
  }

  return { status: "connected" };
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
    const authorization = normalizeHardcoverAuthorization(input);
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
    database
      .prepare(`DELETE FROM connector_snapshots WHERE provider = ?`)
      .bind(provider),
    database
      .prepare(`DELETE FROM sync_runs WHERE provider = ?`)
      .bind(provider),
    database
      .prepare(
        `DELETE FROM connector_oauth_transactions WHERE provider = ?`,
      )
      .bind(provider),
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
         ) VALUES (?, ?, 'connector.credential_deleted', 'connector', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        provider,
        "{}",
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

async function persistRefreshedMyAnimeListCredential(
  database: D1Database,
  credential: MyAnimeListOAuthCredential,
): Promise<void> {
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!encryptionKey) {
    throw new ConnectorFetchError(
      "Connector encryption is not configured.",
      { code: "encryption_key_missing" },
    );
  }
  let encrypted: EncryptedCredential;
  try {
    encrypted = await encryptCredential(
      credential,
      encryptionKey,
      "myanimelist",
    );
  } catch {
    throw new ConnectorFetchError(
      "Connector encryption is not configured.",
      { code: "encryption_key_missing" },
    );
  }
  const result = await database
    .prepare(
      `UPDATE connector_credentials
       SET ciphertext = ?, iv = ?, key_version = ?, expires_at = ?,
           credential_label = 'Owner OAuth authorization', updated_at = ?
       WHERE provider = 'myanimelist'`,
    )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.keyVersion,
      credential.accessTokenExpiresAt,
      new Date().toISOString(),
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ConnectorFetchError(
      "MyAnimeList authorization could not be saved.",
      { code: "credential_persistence_failed", retryable: true },
    );
  }
}

async function fetchConnectorSnapshot(
  database: D1Database,
  provider: ConnectorProvider,
  credential: ConnectorCredential,
): Promise<ConnectorFetchResult> {
  switch (provider) {
    case "myanimelist": {
      let current = credential as MyAnimeListCredential;
      if (
        isMyAnimeListOAuthCredential(current) &&
        shouldRefreshMyAnimeListToken(current)
      ) {
        const refreshed = await refreshMyAnimeListOAuthCredential(current);
        await persistRefreshedMyAnimeListCredential(database, refreshed);
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
      await persistRefreshedMyAnimeListCredential(database, refreshed);
      return fetchMyAnimeListSnapshot(refreshed);
    }
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

    const result = await fetchConnectorSnapshot(
      database,
      provider,
      credential,
    );
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
