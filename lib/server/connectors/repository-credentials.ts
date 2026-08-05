import { runtimeValue } from "../runtime-env";
import {
  decryptCredential,
  encryptCredential,
  type EncryptedCredential,
} from "../credential-crypto";
import { normalizeHardcoverAuthorization } from "./hardcover";
import {
  DISCOGS_EXTENDED_DISPLAY_APPROVAL_SETTING_KEY,
  DISCOGS_PRESENTATION_SETTING_KEY,
} from "./discogs-presentation";
import { DISCOGS_RETRY_MAINTENANCE_KEY } from "./discogs-retry";
import { normalizeMyAnimeListAccessToken } from "./myanimelist";
import { databaseOrNull } from "./repository-primitives";
import { normalizeSteamApiKey, normalizeSteamId } from "./steam";
import { steamStorageCountries } from "./steam-policy";
import { SPOTIFY_PRESENTATION_SETTING_KEY } from "./spotify-presentation";
import {
  ConnectorFetchError,
  type ConnectorCredential,
  type ConnectorCredentialInput,
  type ConnectorProvider,
  type MyAnimeListOAuthCredential,
  type SpotifyOAuthCredential,
} from "./types";

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
           scopes_json, expires_at, generation, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
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
    ...(provider === "spotify" || provider === "discogs"
      ? [
          database
            .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
            .bind(
              provider === "spotify"
                ? SPOTIFY_PRESENTATION_SETTING_KEY
                : DISCOGS_PRESENTATION_SETTING_KEY,
            ),
        ]
      : []),
    ...(provider === "discogs"
      ? [
          database
            .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
            .bind(DISCOGS_EXTENDED_DISPLAY_APPROVAL_SETTING_KEY),
        ]
      : []),
    ...(provider === "discogs"
      ? [
          database
            .prepare(`DELETE FROM maintenance_state WHERE key = ?`)
            .bind(DISCOGS_RETRY_MAINTENANCE_KEY),
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
        "{}",
        now,
      ),
  ]);
}

export type LoadedCredential = {
  credential: ConnectorCredential;
  generation: number;
};

type StoredConnectorCredential = EncryptedCredential & {
  generation: number;
};

export async function loadCredential(
  database: D1Database,
  provider: ConnectorProvider,
): Promise<LoadedCredential | null> {
  const row = await database
    .prepare(
      `SELECT ciphertext, iv, key_version AS keyVersion, generation
       FROM connector_credentials
       WHERE provider = ?
       LIMIT 1`,
    )
    .bind(provider)
    .first<StoredConnectorCredential>();
  if (!row) return null;

  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!encryptionKey) {
    throw new ConnectorFetchError(
      "Connector encryption is not configured.",
      { code: "encryption_key_missing" },
    );
  }

  const credential = await decryptCredential<ConnectorCredential>(
    row,
    encryptionKey,
    provider,
  );
  const generation = Number(row.generation);
  return {
    credential,
    generation:
      Number.isSafeInteger(generation) && generation > 0 ? generation : 1,
  };
}

export async function persistRefreshedMyAnimeListCredential(
  database: D1Database,
  credential: MyAnimeListOAuthCredential,
  expectedGeneration: number,
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
       WHERE provider = 'myanimelist' AND generation = ?`,
    )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.keyVersion,
      credential.accessTokenExpiresAt,
      new Date().toISOString(),
      expectedGeneration,
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ConnectorFetchError(
      "MyAnimeList authorization could not be saved.",
      { code: "credential_changed" },
    );
  }
}

export async function persistRefreshedSpotifyCredential(
  database: D1Database,
  credential: SpotifyOAuthCredential,
  expectedGeneration: number,
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
    encrypted = await encryptCredential(credential, encryptionKey, "spotify");
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
       WHERE provider = 'spotify' AND generation = ?`,
    )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.keyVersion,
      credential.accessTokenExpiresAt,
      new Date().toISOString(),
      expectedGeneration,
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ConnectorFetchError(
      "Spotify authorization could not be saved.",
      { code: "credential_changed" },
    );
  }
}
