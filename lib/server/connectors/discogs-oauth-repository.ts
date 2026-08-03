import { runtimeValue } from "../runtime-env";
import {
  decryptCredential,
  encryptCredential,
  type EncryptedCredential,
} from "../credential-crypto";
import {
  buildDiscogsAuthorizationUrl,
  createDiscogsOAuthNonce,
  exchangeDiscogsAccessToken,
  hashDiscogsOAuthValue,
  isDiscogsLocalCallbackBridgeRequest,
  isDiscogsOAuthCredential,
  isValidDiscogsOAuthOpaqueValue,
  isValidDiscogsOAuthToken,
  normalizeDiscogsOAuthClient,
  requestDiscogsTemporaryCredential,
  resolveDiscogsCallbackUrl,
  type DiscogsOAuthClient,
  type DiscogsOAuthTransactionPayload,
} from "./discogs-oauth";
import { databaseOrNull } from "./repository-primitives";
import {
  ConnectorFetchError,
  type DiscogsOAuthCredential,
} from "./types";
import { DISCOGS_PRESENTATION_SETTING_KEY } from "./discogs-presentation";
import { DISCOGS_RETRY_MAINTENANCE_KEY } from "./discogs-retry";

const TRANSACTION_WINDOW_MS = 10 * 60 * 1000;
const TRANSACTION_CONTEXT = "discogs-oauth-transaction";

export type DiscogsOAuthStartResult =
  | {
      status: "authorization_required";
      provider: "discogs";
      authorizationUrl: string;
      callbackUrl: string;
      expiresAt: string;
    }
  | { status: "invalid"; reason: "credential" }
  | { status: "provider_unavailable" | "rate_limited" | "token_exchange_failed" }
  | {
      status: "setup_required";
      reason: "database" | "encryption_key" | "callback_url";
    };

export type DiscogsOAuthStageResult =
  | { status: "ready"; resumeState: string }
  | { status: "expired" | "invalid_state" | "setup_required" };

export type DiscogsOAuthCompletionResult =
  | { status: "connected" }
  | {
      status:
        | "denied"
        | "expired"
        | "invalid_state"
        | "reauthorization_required"
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
  return resolveDiscogsCallbackUrl(
    requestUrl,
    runtimeValue("SITE_URL"),
    runtimeValue("NODE_ENV") ?? process.env.NODE_ENV,
  );
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
       WHERE state_hash = ? AND provider = 'discogs'
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
       WHERE state_hash = ? AND provider = 'discogs'`,
    )
    .bind(stateHash)
    .run();
}

async function decryptTransaction(
  row: StoredOAuthTransaction,
  encryptionKey: string,
): Promise<DiscogsOAuthTransactionPayload | null> {
  try {
    return await decryptCredential<DiscogsOAuthTransactionPayload>(
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
): Promise<DiscogsOAuthClient | null> {
  const row = await database
    .prepare(
      `SELECT ciphertext, iv, key_version AS keyVersion
       FROM connector_credentials
       WHERE provider = 'discogs'
       LIMIT 1`,
    )
    .first<StoredCredential>();
  if (!row) return null;
  try {
    const credential = await decryptCredential<unknown>(
      row,
      encryptionKey,
      "discogs",
    );
    return isDiscogsOAuthCredential(credential)
      ? {
          consumerKey: credential.consumerKey,
          consumerSecret: credential.consumerSecret,
        }
      : null;
  } catch {
    return null;
  }
}

function startProviderFailure(
  error: unknown,
): DiscogsOAuthStartResult | null {
  if (!(error instanceof ConnectorFetchError)) return null;
  if (error.code === "credential_invalid") {
    return { status: "invalid", reason: "credential" };
  }
  if (error.code === "rate_limited") return { status: "rate_limited" };
  if (error.code === "provider_error") {
    return { status: "provider_unavailable" };
  }
  return { status: "token_exchange_failed" };
}

export async function startDiscogsOAuth(input: {
  consumerKey?: string;
  consumerSecret?: string;
  actorEmail: string;
  browserNonce: string;
  requestUrl: string;
}): Promise<DiscogsOAuthStartResult> {
  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!database) return { status: "setup_required", reason: "database" };
  if (!encryptionKey) {
    return { status: "setup_required", reason: "encryption_key" };
  }
  const redirectUri = callbackUrl(input.requestUrl);
  if (!redirectUri) {
    return { status: "setup_required", reason: "callback_url" };
  }
  if (!isValidDiscogsOAuthOpaqueValue(input.browserNonce)) {
    return { status: "setup_required", reason: "encryption_key" };
  }

  let client: DiscogsOAuthClient | null;
  if (input.consumerKey !== undefined || input.consumerSecret !== undefined) {
    client = normalizeDiscogsOAuthClient(
      input.consumerKey ?? "",
      input.consumerSecret ?? "",
    );
  } else {
    client = await reusableClient(database, encryptionKey);
  }
  if (!client) return { status: "invalid", reason: "credential" };

  let temporaryCredential;
  try {
    temporaryCredential = await requestDiscogsTemporaryCredential(
      client,
      redirectUri,
    );
  } catch (error) {
    return (
      startProviderFailure(error) ?? {
        status: "provider_unavailable",
      }
    );
  }

  const stateHash = await hashDiscogsOAuthValue(
    temporaryCredential.requestToken,
  );
  const browserNonceHash = await hashDiscogsOAuthValue(input.browserNonce);
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
        ...temporaryCredential,
        callbackUrl: redirectUri,
        ownerEmail,
        stateHash,
        browserNonceHash,
      } satisfies DiscogsOAuthTransactionPayload,
      encryptionKey,
      TRANSACTION_CONTEXT,
    );
  } catch {
    return { status: "setup_required", reason: "encryption_key" };
  }

  try {
    await database.batch([
      database
        .prepare(
          `DELETE FROM connector_oauth_transactions
           WHERE expires_at <= ?`,
        )
        .bind(createdAt),
      database
        .prepare(
          `DELETE FROM connector_oauth_transactions
           WHERE provider = 'discogs' AND owner_email = ?`,
        )
        .bind(ownerEmail),
      database
        .prepare(
          `INSERT INTO connector_oauth_transactions (
             state_hash, provider, ciphertext, iv, key_version, owner_email,
             redirect_uri, expires_at, consumed_at, created_at
           ) VALUES (?, 'discogs', ?, ?, ?, ?, ?, ?, NULL, ?)`,
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
    provider: "discogs",
    authorizationUrl: buildDiscogsAuthorizationUrl(
      temporaryCredential.requestToken,
    ),
    callbackUrl: redirectUri,
    expiresAt,
  };
}

export async function stageDiscogsOAuthCallback(input: {
  requestToken: string;
  oauthVerifier?: string;
  denied?: boolean;
  browserNonce?: string;
  requestUrl: string;
}): Promise<DiscogsOAuthStageResult> {
  const environment = runtimeValue("NODE_ENV") ?? process.env.NODE_ENV;
  const localCallbackBridge = isDiscogsLocalCallbackBridgeRequest(
    input.requestUrl,
    runtimeValue("SITE_URL"),
    environment,
  );
  const hasBrowserNonce = input.browserNonce !== undefined;
  if (
    !isValidDiscogsOAuthToken(input.requestToken) ||
    (hasBrowserNonce &&
      !isValidDiscogsOAuthOpaqueValue(input.browserNonce ?? "")) ||
    (!hasBrowserNonce && !localCallbackBridge) ||
    (input.denied === true && input.oauthVerifier !== undefined) ||
    (input.denied !== true &&
      (!input.oauthVerifier ||
        !isValidDiscogsOAuthToken(input.oauthVerifier)))
  ) {
    return { status: "invalid_state" };
  }

  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  const redirectUri = callbackUrl(input.requestUrl);
  if (!database || !encryptionKey || !redirectUri) {
    return { status: "setup_required" };
  }
  const stateHash = await hashDiscogsOAuthValue(input.requestToken);
  const browserNonceHash = hasBrowserNonce
    ? await hashDiscogsOAuthValue(input.browserNonce ?? "")
    : null;
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
    transaction.requestToken !== input.requestToken ||
    transaction.callbackUrl !== redirectUri ||
    transaction.ownerEmail !== normalizedOwnerEmail(row.ownerEmail) ||
    transaction.stateHash !== stateHash ||
    (browserNonceHash !== null &&
      transaction.browserNonceHash !== browserNonceHash)
  ) {
    return { status: "invalid_state" };
  }

  const resumeState = createDiscogsOAuthNonce();
  const resumeStateHash = await hashDiscogsOAuthValue(resumeState);
  let encrypted: EncryptedCredential;
  try {
    encrypted = await encryptCredential(
      {
        ...transaction,
        phase: "callback",
        stateHash: resumeStateHash,
        ...(input.denied === true
          ? { denied: true as const }
          : { oauthVerifier: input.oauthVerifier }),
      } satisfies DiscogsOAuthTransactionPayload,
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
         WHERE state_hash = ? AND provider = 'discogs'
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
  credential: DiscogsOAuthCredential,
  actorEmail: string,
  stateHash: string,
): Promise<void> {
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!encryptionKey) throw new Error("Connector encryption is unavailable.");
  const encrypted = await encryptCredential(
    credential,
    encryptionKey,
    "discogs",
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
         SELECT 'discogs', ?, ?, ?, 'Owner OAuth authorization',
                '[]', NULL, 1, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM connector_oauth_transactions
           WHERE state_hash = ? AND provider = 'discogs'
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
           updated_at = excluded.updated_at`,
      )
      .bind(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.keyVersion,
        now,
        now,
        stateHash,
        ownerEmail,
        now,
      ),
    database
      .prepare(
        `DELETE FROM connector_snapshots
         WHERE provider = 'discogs'
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'discogs' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(encrypted.ciphertext, encrypted.iv, now),
    database
      .prepare(
        `DELETE FROM sync_runs
         WHERE provider = 'discogs'
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'discogs' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(encrypted.ciphertext, encrypted.iv, now),
    database
      .prepare(
        `DELETE FROM editorial_settings
         WHERE key = ?
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'discogs' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(
        DISCOGS_PRESENTATION_SETTING_KEY,
        encrypted.ciphertext,
        encrypted.iv,
        now,
      ),
    database
      .prepare(
        `DELETE FROM maintenance_state
         WHERE key = ?
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'discogs' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(
        DISCOGS_RETRY_MAINTENANCE_KEY,
        encrypted.ciphertext,
        encrypted.iv,
        now,
      ),
    database
      .prepare(
        `DELETE FROM audit_log
         WHERE entity_type = 'connector' AND entity_id = 'discogs'
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'discogs' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(encrypted.ciphertext, encrypted.iv, now),
    database
      .prepare(
        `DELETE FROM connector_oauth_transactions
         WHERE provider = 'discogs' AND owner_email = ?
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'discogs' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(ownerEmail, encrypted.ciphertext, encrypted.iv, now),
    database
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id,
           details_json, created_at
         )
         SELECT ?, ?, 'connector.oauth_connected', 'connector',
                'discogs', '{}', ?
         WHERE EXISTS (
           SELECT 1 FROM connector_credentials
           WHERE provider = 'discogs' AND ciphertext = ?
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
      "The Discogs authorization was cancelled before it could be saved.",
      { code: "credential_changed" },
    );
  }
}

export async function completeDiscogsOAuth(input: {
  resumeState: string;
  actorEmail: string;
  browserNonce: string;
  requestUrl: string;
}): Promise<DiscogsOAuthCompletionResult> {
  if (
    !isValidDiscogsOAuthOpaqueValue(input.resumeState) ||
    !isValidDiscogsOAuthOpaqueValue(input.browserNonce)
  ) {
    return { status: "invalid_state" };
  }
  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  const redirectUri = callbackUrl(input.requestUrl);
  if (!database || !encryptionKey || !redirectUri) {
    return { status: "setup_required" };
  }
  const stateHash = await hashDiscogsOAuthValue(input.resumeState);
  const browserNonceHash = await hashDiscogsOAuthValue(input.browserNonce);
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
    normalizedOwnerEmail(row.ownerEmail) !==
      normalizedOwnerEmail(input.actorEmail)
  ) {
    return { status: "invalid_state" };
  }
  const transaction = await decryptTransaction(row, encryptionKey);
  if (
    !transaction ||
    transaction.phase !== "callback" ||
    transaction.callbackUrl !== redirectUri ||
    transaction.ownerEmail !== normalizedOwnerEmail(input.actorEmail) ||
    transaction.stateHash !== stateHash ||
    transaction.browserNonceHash !== browserNonceHash
  ) {
    return { status: "invalid_state" };
  }

  const consumedAt = new Date().toISOString();
  try {
    const consumed = await database
      .prepare(
        `UPDATE connector_oauth_transactions
         SET consumed_at = ?
         WHERE state_hash = ? AND provider = 'discogs'
           AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(consumedAt, stateHash, consumedAt)
      .run();
    if ((consumed.meta.changes ?? 0) !== 1) {
      return { status: "invalid_state" };
    }
  } catch {
    return { status: "setup_required" };
  }

  if (transaction.denied === true) {
    try {
      await deleteTransaction(database, stateHash);
    } catch {
      return { status: "setup_required" };
    }
    return { status: "denied" };
  }
  if (!transaction.oauthVerifier) {
    try {
      await deleteTransaction(database, stateHash);
    } catch {
      return { status: "setup_required" };
    }
    return { status: "invalid_state" };
  }

  let credential: DiscogsOAuthCredential;
  try {
    credential = await exchangeDiscogsAccessToken({
      client: {
        consumerKey: transaction.consumerKey,
        consumerSecret: transaction.consumerSecret,
      },
      requestToken: transaction.requestToken,
      requestTokenSecret: transaction.requestTokenSecret,
      oauthVerifier: transaction.oauthVerifier,
    });
  } catch (error) {
    try {
      await deleteTransaction(database, stateHash);
    } catch {
      // Consumption already prevents replay.
    }
    if (error instanceof ConnectorFetchError) {
      if (error.code === "reauthorization_required") {
        return { status: "reauthorization_required" };
      }
      if (error.code === "rate_limited") {
        return { status: "rate_limited" };
      }
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
      // Consumption already prevents replay.
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
