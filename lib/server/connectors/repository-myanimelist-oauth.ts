import { runtimeValue } from "../runtime-env";
import {
  decryptCredential,
  encryptCredential,
  type EncryptedCredential,
} from "../credential-crypto";
import {
  buildMyAnimeListAuthorizationUrl,
  createMyAnimeListOAuthState,
  createMyAnimeListPkceVerifier,
  exchangeMyAnimeListAuthorizationCode,
  hashMyAnimeListOAuthState,
  isMyAnimeListOAuthCredential,
  isValidMyAnimeListOAuthState,
  normalizeMyAnimeListOAuthClient,
  resolveMyAnimeListCallbackUrl,
  type MyAnimeListOAuthClient,
  type MyAnimeListOAuthTransactionPayload,
} from "./myanimelist-oauth";
import {
  loadCredential,
} from "./repository-credentials";
import {
  type MyAnimeListOAuthCompletionResult,
  type MyAnimeListOAuthStageResult,
  type MyAnimeListOAuthStartResult,
} from "./repository-contracts";
import { databaseOrNull } from "./repository-primitives";
import {
  connectorPublicationApprovalPendingSettingKey,
  connectorPublicationApprovalPendingValue,
  connectorPublicationApprovalSettingKey,
} from "./publication-approval";
import {
  ConnectorFetchError,
  type MyAnimeListOAuthCredential,
} from "./types";

const OAUTH_TRANSACTION_WINDOW_MS = 10 * 60 * 1000;
const MYANIMELIST_OAUTH_TRANSACTION_CONTEXT =
  "myanimelist-oauth-transaction";

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
  return value.trim().toLowerCase();
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

async function deleteOAuthTransaction(
  database: D1Database,
  stateHash: string,
): Promise<void> {
  await database
    .prepare(
      `DELETE FROM connector_oauth_transactions
       WHERE state_hash = ? AND provider = 'myanimelist'`,
    )
    .bind(stateHash)
    .run();
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
  replaceExisting?: boolean;
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
  const hasSuppliedClient =
    input.clientId !== undefined || input.clientSecret !== undefined;
  if (
    input.replaceExisting !== undefined &&
    input.replaceExisting !== hasSuppliedClient
  ) {
    return { status: "invalid", reason: "credential" };
  }
  if (hasSuppliedClient) {
    client = normalizeMyAnimeListOAuthClient(
      input.clientId ?? "",
      input.clientSecret ?? "",
    );
  } else {
    try {
      const existing = await loadCredential(database, "myanimelist");
      if (
        existing &&
        isMyAnimeListOAuthCredential(existing.credential)
      ) {
        client = {
          clientId: existing.credential.clientId,
          clientSecret: existing.credential.clientSecret,
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
  const ownerEmail = normalizedOwnerEmail(input.actorEmail);
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
        replaceExisting: input.replaceExisting ?? hasSuppliedClient,
        ...client,
        codeVerifier,
        callbackUrl,
        ownerEmail,
        stateHash,
      } satisfies MyAnimeListOAuthTransactionPayload,
      encryptionKey,
      MYANIMELIST_OAUTH_TRANSACTION_CONTEXT,
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
      redirectUri: callbackUrl,
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
  if (Date.parse(row.expiresAt) <= Date.now()) {
    try {
      await deleteOAuthTransaction(database, stateHash);
    } catch {
      return { status: "setup_required" };
    }
    return { status: "expired" };
  }
  if (row.redirectUri !== callbackUrl) return { status: "invalid_state" };

  const transaction = await decryptOAuthTransaction(row, encryptionKey);
  if (
    !transaction ||
    transaction.phase !== "authorization" ||
    typeof transaction.replaceExisting !== "boolean" ||
    transaction.callbackUrl !== callbackUrl ||
    transaction.ownerEmail !== normalizedOwnerEmail(row.ownerEmail) ||
    transaction.stateHash !== stateHash
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
        stateHash: resumeStateHash,
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
  stateHash: string,
  replaceExisting: boolean,
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
  const credentialStatement = database
      .prepare(
        `INSERT INTO connector_credentials (
           provider, ciphertext, iv, key_version, credential_label,
           scopes_json, expires_at, generation, created_at, updated_at
         )
         SELECT 'myanimelist', ?, ?, ?, ?, '[]', ?, 1, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM connector_oauth_transactions
           WHERE state_hash = ? AND provider = 'myanimelist'
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
        "Owner OAuth authorization",
        credential.accessTokenExpiresAt,
        now,
        now,
        stateHash,
        ownerEmail,
        now,
      );
  const destructiveStatements = replaceExisting
    ? [
    database
      .prepare(
        `DELETE FROM connector_snapshots
         WHERE provider = 'myanimelist'
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'myanimelist' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(encrypted.ciphertext, encrypted.iv, now),
    database
      .prepare(
        `DELETE FROM sync_runs
         WHERE provider = 'myanimelist'
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'myanimelist' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(encrypted.ciphertext, encrypted.iv, now),
    database
      .prepare(
        `DELETE FROM audit_log
         WHERE entity_type = 'connector' AND entity_id = 'myanimelist'
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'myanimelist' AND ciphertext = ?
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
             WHERE provider = 'myanimelist' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(
        connectorPublicationApprovalSettingKey("myanimelist"),
        encrypted.ciphertext,
        encrypted.iv,
        now,
      ),
    database
      .prepare(
        `INSERT INTO editorial_settings (
           key, value_json, updated_by_email, updated_at
         )
         SELECT ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM connector_credentials
           WHERE provider = 'myanimelist' AND ciphertext = ?
             AND iv = ? AND updated_at = ?
         )
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_by_email = excluded.updated_by_email,
           updated_at = excluded.updated_at`,
      )
      .bind(
        connectorPublicationApprovalPendingSettingKey("myanimelist"),
        connectorPublicationApprovalPendingValue("myanimelist", now),
        actorEmail,
        now,
        encrypted.ciphertext,
        encrypted.iv,
        now,
      ),
    ]
    : [];
  const routineReauthorizationStatements = replaceExisting
    ? []
    : [
        database
          .prepare(
            `DELETE FROM editorial_settings
             WHERE key = ?
               AND NOT EXISTS (
                 SELECT 1 FROM connector_snapshots
                 WHERE provider = 'myanimelist' AND status = 'ready'
               )
               AND EXISTS (
                 SELECT 1 FROM connector_credentials
                 WHERE provider = 'myanimelist' AND ciphertext = ?
                   AND iv = ? AND updated_at = ?
               )`,
          )
          .bind(
            connectorPublicationApprovalSettingKey("myanimelist"),
            encrypted.ciphertext,
            encrypted.iv,
            now,
          ),
        database
          .prepare(
            `INSERT INTO editorial_settings (
               key, value_json, updated_by_email, updated_at
             )
             SELECT ?, ?, ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM connector_snapshots
               WHERE provider = 'myanimelist' AND status = 'ready'
             )
               AND EXISTS (
                 SELECT 1 FROM connector_credentials
                 WHERE provider = 'myanimelist' AND ciphertext = ?
                   AND iv = ? AND updated_at = ?
               )
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               updated_by_email = excluded.updated_by_email,
               updated_at = excluded.updated_at`,
          )
          .bind(
            connectorPublicationApprovalPendingSettingKey("myanimelist"),
            connectorPublicationApprovalPendingValue("myanimelist", now),
            actorEmail,
            now,
            encrypted.ciphertext,
            encrypted.iv,
            now,
          ),
      ];
  const results = await database.batch([
    credentialStatement,
    ...destructiveStatements,
    ...routineReauthorizationStatements,
    database
      .prepare(
        `DELETE FROM connector_oauth_transactions
         WHERE provider = 'myanimelist' AND owner_email = ?
           AND EXISTS (
             SELECT 1 FROM connector_credentials
             WHERE provider = 'myanimelist' AND ciphertext = ?
               AND iv = ? AND updated_at = ?
           )`,
      )
      .bind(ownerEmail, encrypted.ciphertext, encrypted.iv, now),
    database
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         )
         SELECT ?, ?, 'connector.oauth_connected', 'connector',
                'myanimelist', '{}', ?
         WHERE EXISTS (
           SELECT 1 FROM connector_credentials
           WHERE provider = 'myanimelist' AND ciphertext = ?
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
      "The MyAnimeList authorization was cancelled before it could be saved.",
      { code: "credential_changed" },
    );
  }
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
  if (Date.parse(row.expiresAt) <= Date.now()) {
    try {
      await deleteOAuthTransaction(database, stateHash);
    } catch {
      return { status: "setup_required" };
    }
    return { status: "expired" };
  }
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
    typeof transaction.replaceExisting !== "boolean" ||
    transaction.callbackUrl !== callbackUrl ||
    transaction.ownerEmail !== normalizedOwnerEmail(row.ownerEmail) ||
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
    try {
      await deleteOAuthTransaction(database, stateHash);
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
      await deleteOAuthTransaction(database, stateHash);
    } catch {
      return { status: "setup_required" };
    }
    return { status: "invalid_state" };
  }

  let credential: MyAnimeListOAuthCredential;
  try {
    credential = await exchangeMyAnimeListAuthorizationCode({
      clientId: transaction.clientId,
      clientSecret: transaction.clientSecret,
      authorizationCode: transaction.authorizationCode,
      codeVerifier: transaction.codeVerifier,
      redirectUri: transaction.callbackUrl,
    });
  } catch (error) {
    try {
      await deleteOAuthTransaction(database, stateHash);
    } catch {
      // The transaction remains unusable because it was already consumed.
    }
    if (error instanceof ConnectorFetchError) {
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
    await saveMyAnimeListOAuthCredential(
      database,
      credential,
      input.actorEmail,
      stateHash,
      transaction.replaceExisting,
    );
  } catch (error) {
    try {
      await deleteOAuthTransaction(database, stateHash);
    } catch {
      // The transaction remains unusable because it was already consumed.
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
