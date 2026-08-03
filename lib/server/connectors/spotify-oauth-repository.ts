import { runtimeDatabase, runtimeValue } from "../runtime-env";
import {
  decryptCredential,
  encryptCredential,
  type EncryptedCredential,
} from "../credential-crypto";
import {
  buildSpotifyAuthorizationUrl,
  createSpotifyOAuthState,
  createSpotifyPkceChallenge,
  createSpotifyPkceVerifier,
  exchangeSpotifyAuthorizationCode,
  hashSpotifyOAuthState,
  isSpotifyOAuthCredential,
  isValidSpotifyOAuthState,
  normalizeSpotifyOAuthClient,
  resolveSpotifyCallbackUrl,
  SPOTIFY_OAUTH_SCOPES,
  type SpotifyOAuthClient,
  type SpotifyOAuthTransactionPayload,
} from "./spotify-oauth";
import { SPOTIFY_PRESENTATION_SETTING_KEY } from "./spotify-presentation";
import {
  ConnectorFetchError,
  type SpotifyOAuthCredential,
} from "./types";

const TRANSACTION_WINDOW_MS = 10 * 60 * 1000;
const TRANSACTION_CONTEXT = "spotify-oauth-transaction";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export type SpotifyOAuthStartResult =
  | {
      status: "authorization_required";
      provider: "spotify";
      authorizationUrl: string;
      callbackUrl: string;
      expiresAt: string;
    }
  | { status: "invalid"; reason: "credential" }
  | {
      status: "setup_required";
      reason: "database" | "encryption_key" | "callback_url";
    };

export type SpotifyOAuthStageResult =
  | { status: "ready"; resumeState: string }
  | { status: "expired" | "invalid_state" | "setup_required" };

export type SpotifyOAuthCompletionResult =
  | { status: "connected" }
  | {
      status:
        | "denied"
        | "expired"
        | "invalid_state"
        | "provider_unavailable"
        | "rate_limited"
        | "token_exchange_failed"
        | "setup_required";
    };

type StoredOAuthTransaction = EncryptedCredential & {
  stateHash: string;
  ownerEmail: string;
  redirectUri: string;
  expiresAt: string;
  consumedAt: string | null;
};

type StoredCredential = EncryptedCredential;

function normalizedOwnerEmail(value: string): string {
  return value.trim().toLowerCase();
}

function callbackUrl(requestUrl: string): string | null {
  return resolveSpotifyCallbackUrl(
    requestUrl,
    runtimeValue("SITE_URL"),
    runtimeValue("NODE_ENV") ?? process.env.NODE_ENV,
  );
}

function validAuthorizationCode(value: string | undefined): string | null {
  const candidate = value?.trim() ?? "";
  return candidate.length >= 8 &&
    candidate.length <= 8192 &&
    !CONTROL_CHARACTER.test(candidate)
    ? candidate
    : null;
}

function validProviderError(value: string | undefined): string | null {
  const candidate = value?.trim() ?? "";
  return /^[a-z0-9_]{1,64}$/i.test(candidate) ? candidate : null;
}

async function storedTransaction(
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
       WHERE state_hash = ? AND provider = 'spotify'
       LIMIT 1`,
    )
    .bind(stateHash)
    .first<StoredOAuthTransaction>();
}

async function deleteTransaction(
  database: D1Database,
  stateHash: string,
): Promise<void> {
  await database
    .prepare(
      `DELETE FROM connector_oauth_transactions
       WHERE state_hash = ? AND provider = 'spotify'`,
    )
    .bind(stateHash)
    .run();
}

async function decryptTransaction(
  row: StoredOAuthTransaction,
  encryptionKey: string,
): Promise<SpotifyOAuthTransactionPayload | null> {
  try {
    return await decryptCredential<SpotifyOAuthTransactionPayload>(
      row,
      encryptionKey,
      TRANSACTION_CONTEXT,
    );
  } catch {
    return null;
  }
}

async function reusableClient(
  database: D1Database,
  encryptionKey: string,
): Promise<SpotifyOAuthClient | null> {
  const row = await database
    .prepare(
      `SELECT ciphertext, iv, key_version AS keyVersion
       FROM connector_credentials
       WHERE provider = 'spotify'
       LIMIT 1`,
    )
    .first<StoredCredential>();
  if (!row) return null;
  try {
    const credential = await decryptCredential<unknown>(
      row,
      encryptionKey,
      "spotify",
    );
    return isSpotifyOAuthCredential(credential)
      ? {
          clientId: credential.clientId,
          clientSecret: credential.clientSecret,
        }
      : null;
  } catch {
    return null;
  }
}

export async function startSpotifyOAuth(input: {
  clientId?: string;
  clientSecret?: string;
  actorEmail: string;
  requestUrl: string;
}): Promise<SpotifyOAuthStartResult> {
  const database = runtimeDatabase();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!database) return { status: "setup_required", reason: "database" };
  if (!encryptionKey) {
    return { status: "setup_required", reason: "encryption_key" };
  }
  const redirectUri = callbackUrl(input.requestUrl);
  if (!redirectUri) {
    return { status: "setup_required", reason: "callback_url" };
  }

  let client: SpotifyOAuthClient | null;
  if (input.clientId !== undefined || input.clientSecret !== undefined) {
    client = normalizeSpotifyOAuthClient(
      input.clientId ?? "",
      input.clientSecret ?? "",
    );
  } else {
    client = await reusableClient(database, encryptionKey);
  }
  if (!client) return { status: "invalid", reason: "credential" };

  const state = createSpotifyOAuthState();
  const stateHash = await hashSpotifyOAuthState(state);
  const codeVerifier = createSpotifyPkceVerifier();
  const codeChallenge = await createSpotifyPkceChallenge(codeVerifier);
  const ownerEmail = normalizedOwnerEmail(input.actorEmail);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + TRANSACTION_WINDOW_MS,
  ).toISOString();
  let encrypted: EncryptedCredential;
  try {
    encrypted = await encryptCredential(
      {
        phase: "authorization",
        ...client,
        codeVerifier,
        callbackUrl: redirectUri,
        ownerEmail,
        stateHash,
      } satisfies SpotifyOAuthTransactionPayload,
      encryptionKey,
      TRANSACTION_CONTEXT,
    );
  } catch {
    return { status: "setup_required", reason: "encryption_key" };
  }

  try {
    await database.batch([
      database
        .prepare(`DELETE FROM connector_oauth_transactions WHERE expires_at <= ?`)
        .bind(createdAt),
      database
        .prepare(
          `DELETE FROM connector_oauth_transactions
           WHERE provider = 'spotify' AND owner_email = ?`,
        )
        .bind(ownerEmail),
      database
        .prepare(
          `INSERT INTO connector_oauth_transactions (
             state_hash, provider, ciphertext, iv, key_version, owner_email,
             redirect_uri, expires_at, consumed_at, created_at
           ) VALUES (?, 'spotify', ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .bind(
          stateHash,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.keyVersion,
          ownerEmail,
          redirectUri,
          expiresAt,
          createdAt,
        ),
    ]);
  } catch {
    return { status: "setup_required", reason: "database" };
  }
  return {
    status: "authorization_required",
    provider: "spotify",
    authorizationUrl: buildSpotifyAuthorizationUrl({
      clientId: client.clientId,
      codeChallenge,
      redirectUri,
      state,
    }),
    callbackUrl: redirectUri,
    expiresAt,
  };
}

export async function stageSpotifyOAuthCallback(input: {
  state: string;
  authorizationCode?: string;
  providerError?: string;
  requestUrl: string;
}): Promise<SpotifyOAuthStageResult> {
  if (!isValidSpotifyOAuthState(input.state)) {
    return { status: "invalid_state" };
  }
  const authorizationCode = validAuthorizationCode(input.authorizationCode);
  const providerError = validProviderError(input.providerError);
  if (!authorizationCode && !providerError) return { status: "invalid_state" };

  const database = runtimeDatabase();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  const redirectUri = callbackUrl(input.requestUrl);
  if (!database || !encryptionKey || !redirectUri) {
    return { status: "setup_required" };
  }
  const stateHash = await hashSpotifyOAuthState(input.state);
  let row: StoredOAuthTransaction | null;
  try {
    row = await storedTransaction(database, stateHash);
  } catch {
    return { status: "setup_required" };
  }
  if (!row || row.consumedAt) return { status: "invalid_state" };
  if (Date.parse(row.expiresAt) <= Date.now()) {
    try {
      await deleteTransaction(database, stateHash);
    } catch {
      return { status: "setup_required" };
    }
    return { status: "expired" };
  }
  if (row.redirectUri !== redirectUri) return { status: "invalid_state" };

  const transaction = await decryptTransaction(row, encryptionKey);
  if (
    !transaction ||
    transaction.phase !== "authorization" ||
    transaction.callbackUrl !== redirectUri ||
    transaction.ownerEmail !== normalizedOwnerEmail(row.ownerEmail) ||
    transaction.stateHash !== stateHash
  ) {
    return { status: "invalid_state" };
  }

  const resumeState = createSpotifyOAuthState();
  const resumeStateHash = await hashSpotifyOAuthState(resumeState);
  let encrypted: EncryptedCredential;
  try {
    encrypted = await encryptCredential(
      {
        ...transaction,
        phase: "callback",
        stateHash: resumeStateHash,
        ...(authorizationCode ? { authorizationCode } : {}),
        ...(providerError ? { providerError } : {}),
      } satisfies SpotifyOAuthTransactionPayload,
      encryptionKey,
      TRANSACTION_CONTEXT,
    );
  } catch {
    return { status: "setup_required" };
  }

  try {
    const result = await database
      .prepare(
        `UPDATE connector_oauth_transactions
         SET state_hash = ?, ciphertext = ?, iv = ?, key_version = ?
         WHERE state_hash = ? AND provider = 'spotify'
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
    return (result.meta.changes ?? 0) === 1
      ? { status: "ready", resumeState }
      : { status: "invalid_state" };
  } catch {
    return { status: "setup_required" };
  }
}

async function saveCredential(
  database: D1Database,
  credential: SpotifyOAuthCredential,
  actorEmail: string,
  stateHash: string,
): Promise<void> {
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!encryptionKey) throw new Error("Connector encryption is unavailable.");
  const encrypted = await encryptCredential(
    credential,
    encryptionKey,
    "spotify",
  );
  const now = new Date().toISOString();
  const ownerEmail = normalizedOwnerEmail(actorEmail);
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO connector_credentials (
           provider, ciphertext, iv, key_version, credential_label,
           scopes_json, expires_at, generation, created_at, updated_at
         )
         SELECT 'spotify', ?, ?, ?, 'Owner OAuth authorization', ?, ?, 1, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM connector_oauth_transactions
           WHERE state_hash = ? AND provider = 'spotify'
             AND owner_email = ? AND consumed_at IS NOT NULL
             AND expires_at > ?
         )
         ON CONFLICT(provider) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           key_version = excluded.key_version,
           credential_label = excluded.credential_label,
           scopes_json = excluded.scopes_json,
           expires_at = excluded.expires_at,
           generation = connector_credentials.generation + 1,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.keyVersion,
        JSON.stringify(SPOTIFY_OAUTH_SCOPES),
        credential.accessTokenExpiresAt,
        now,
        now,
        stateHash,
        ownerEmail,
        now,
      ),
    database.prepare(`DELETE FROM connector_snapshots WHERE provider = 'spotify'`),
    database.prepare(`DELETE FROM sync_runs WHERE provider = 'spotify'`),
    database
      .prepare(
        `DELETE FROM audit_log
         WHERE entity_type = 'connector' AND entity_id = 'spotify'`,
      ),
    database
      .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
      .bind(SPOTIFY_PRESENTATION_SETTING_KEY),
    database
      .prepare(
        `DELETE FROM connector_oauth_transactions
         WHERE provider = 'spotify' AND owner_email = ?`,
      )
      .bind(ownerEmail),
    database
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id,
           details_json, created_at
         )
         SELECT ?, ?, 'connector.oauth_connected', 'connector',
                'spotify', '{}', ?
         WHERE EXISTS (
           SELECT 1 FROM connector_credentials
           WHERE provider = 'spotify' AND ciphertext = ?
             AND iv = ? AND updated_at = ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        now,
        encrypted.ciphertext,
        encrypted.iv,
        now,
      ),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    throw new ConnectorFetchError(
      "The Spotify authorization was cancelled before it could be saved.",
      { code: "credential_changed" },
    );
  }
}

export async function completeSpotifyOAuth(input: {
  resumeState: string;
  actorEmail: string;
  requestUrl: string;
}): Promise<SpotifyOAuthCompletionResult> {
  if (!isValidSpotifyOAuthState(input.resumeState)) {
    return { status: "invalid_state" };
  }
  const database = runtimeDatabase();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  const redirectUri = callbackUrl(input.requestUrl);
  if (!database || !encryptionKey || !redirectUri) {
    return { status: "setup_required" };
  }
  const stateHash = await hashSpotifyOAuthState(input.resumeState);
  let row: StoredOAuthTransaction | null;
  try {
    row = await storedTransaction(database, stateHash);
  } catch {
    return { status: "setup_required" };
  }
  if (!row || row.consumedAt) return { status: "invalid_state" };
  if (Date.parse(row.expiresAt) <= Date.now()) {
    try {
      await deleteTransaction(database, stateHash);
    } catch {
      return { status: "setup_required" };
    }
    return { status: "expired" };
  }
  if (
    row.redirectUri !== redirectUri ||
    normalizedOwnerEmail(row.ownerEmail) !== normalizedOwnerEmail(input.actorEmail)
  ) {
    return { status: "invalid_state" };
  }
  const transaction = await decryptTransaction(row, encryptionKey);
  if (
    !transaction ||
    transaction.phase !== "callback" ||
    transaction.callbackUrl !== redirectUri ||
    transaction.ownerEmail !== normalizedOwnerEmail(input.actorEmail) ||
    transaction.stateHash !== stateHash
  ) {
    return { status: "invalid_state" };
  }

  try {
    const consumed = await database
      .prepare(
        `UPDATE connector_oauth_transactions
         SET consumed_at = ?
         WHERE state_hash = ? AND provider = 'spotify'
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
    try {
      await deleteTransaction(database, stateHash);
    } catch {
      return { status: "setup_required" };
    }
    return {
      status:
        transaction.providerError === "access_denied"
          ? "denied"
          : "token_exchange_failed",
    };
  }
  if (!transaction.authorizationCode) {
    try {
      await deleteTransaction(database, stateHash);
    } catch {
      return { status: "setup_required" };
    }
    return { status: "invalid_state" };
  }

  let credential: SpotifyOAuthCredential;
  try {
    credential = await exchangeSpotifyAuthorizationCode({
      clientId: transaction.clientId,
      clientSecret: transaction.clientSecret,
      authorizationCode: transaction.authorizationCode,
      codeVerifier: transaction.codeVerifier,
      redirectUri: transaction.callbackUrl,
    });
  } catch (error) {
    try {
      await deleteTransaction(database, stateHash);
    } catch {
      // Already consumed transactions cannot be replayed.
    }
    if (error instanceof ConnectorFetchError) {
      if (error.code === "rate_limited") return { status: "rate_limited" };
      if (error.code === "provider_error") {
        return { status: "provider_unavailable" };
      }
    }
    return { status: "token_exchange_failed" };
  }

  try {
    await saveCredential(database, credential, input.actorEmail, stateHash);
  } catch (error) {
    try {
      await deleteTransaction(database, stateHash);
    } catch {
      // Already consumed transactions cannot be replayed.
    }
    return {
      status:
        error instanceof ConnectorFetchError &&
        error.code === "credential_changed"
          ? "invalid_state"
          : "setup_required",
    };
  }
  return { status: "connected" };
}
