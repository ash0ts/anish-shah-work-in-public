import { decryptCredential, encryptCredential } from "./credential-crypto";
import { runtimeDatabase, runtimeValue } from "./runtime-env";
import { normalizeHardcoverAuthorization } from "./connectors/hardcover";
import {
  loadCredential,
  saveConnectorCredential,
} from "./connectors/repository-credentials";
import {
  normalizeSteamApiKey,
  normalizeSteamId,
} from "./connectors/steam";
import { steamStorageCountries } from "./connectors/steam-policy";
import type {
  HardcoverCredential,
  SteamCredential,
} from "./connectors/types";
import {
  applyStravaPortableConfig,
  getStravaPortableConfig,
  isStravaPortableConfig,
  type StravaPortableConfig,
} from "./strava-config";

const CODE_VERSION = "play1";
const CODE_WINDOW_MS = 10 * 60 * 1000;
const STAGED_WINDOW_MS = 30 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const PROMOTION_CONTEXT_PREFIX = "play-promotion";

type PortablePlayPayload = {
  schemaVersion: "1.0";
  exportedAt: string;
  providers: {
    hardcover?: HardcoverCredential;
    steam?: SteamCredential;
    strava?: StravaPortableConfig;
  };
};

type PromotionCodePayload = {
  id: string;
  origin: string;
};

type StoredPromotion = {
  id: string;
  tokenHash: string;
  ownerEmail: string;
  targetOrigin: string;
  status: string;
  attempts: number;
  ciphertext: string | null;
  iv: string | null;
  keyVersion: string | null;
  providersJson: string;
  expiresAt: string;
  stagedExpiresAt: string | null;
  createdAt: string;
};

export type PromotionSummary = {
  id: string;
  status: "staged" | "applying" | "applied";
  providers: Array<"hardcover" | "steam" | "strava">;
  createdAt: string;
  expiresAt: string;
};

export type PromotionProviderOutcome = {
  provider: "hardcover" | "steam" | "strava";
  status: "applied" | "failed";
  code?: string;
};

function databaseOrNull(): D1Database | null {
  return runtimeDatabase();
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson<T>(value: string): T | null {
  const bytes = base64UrlDecode(value);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

function canonicalHttpsOrigin(value: string | undefined): string | null {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.origin;
}

async function hashPromotionToken(id: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`anish-site:${CODE_VERSION}:${id}:${secret}`),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function parsePromotionCode(value: unknown):
  | { payload: PromotionCodePayload; secret: string }
  | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  const parts = value.trim().split(".");
  if (parts.length !== 3 || parts[0] !== CODE_VERSION) return null;
  const payload = decodeJson<PromotionCodePayload>(parts[1]);
  const secretBytes = base64UrlDecode(parts[2]);
  if (
    !payload ||
    typeof payload.id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(payload.id) ||
    canonicalHttpsOrigin(payload.origin) !== payload.origin ||
    !secretBytes ||
    secretBytes.byteLength !== 32
  ) {
    return null;
  }
  return { payload, secret: parts[2] };
}

function providerNames(payload: PortablePlayPayload): PromotionSummary["providers"] {
  return (["hardcover", "steam", "strava"] as const).filter(
    (provider) => Boolean(payload.providers[provider]),
  );
}

function validPortablePayload(value: unknown): value is PortablePlayPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<PortablePlayPayload>;
  if (
    candidate.schemaVersion !== "1.0" ||
    typeof candidate.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.exportedAt)) ||
    typeof candidate.providers !== "object" ||
    candidate.providers === null ||
    Array.isArray(candidate.providers)
  ) {
    return false;
  }
  const keys = Object.keys(candidate.providers);
  if (
    keys.length === 0 ||
    keys.some((key) => !["hardcover", "steam", "strava"].includes(key))
  ) {
    return false;
  }
  const hardcover = candidate.providers.hardcover;
  if (
    hardcover &&
    (!normalizeHardcoverAuthorization(hardcover.authorization) ||
      Object.keys(hardcover).some((key) => key !== "authorization"))
  ) {
    return false;
  }
  const steam = candidate.providers.steam;
  if (
    steam &&
    (!normalizeSteamApiKey(steam.apiKey) ||
      !normalizeSteamId(steam.steamId) ||
      Object.keys(steam).some((key) => !["apiKey", "steamId"].includes(key)))
  ) {
    return false;
  }
  if (
    Object.hasOwn(candidate.providers, "strava") &&
    !isStravaPortableConfig(candidate.providers.strava)
  ) {
    return false;
  }
  return true;
}

async function prunePromotionTransactions(database: D1Database): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  await database
    .prepare(`DELETE FROM play_promotion_transactions WHERE created_at <= ?`)
    .bind(cutoff)
    .run();
}

export async function issuePlayPromotion(input: {
  ownerEmail: string;
  requestUrl: string;
}): Promise<
  | { status: "issued"; code: string; expiresAt: string; targetOrigin: string }
  | { status: "setup_required"; reason: "database" | "encryption_key" | "origin" }
> {
  const database = databaseOrNull();
  if (!database) return { status: "setup_required", reason: "database" };
  if (!runtimeValue("CONNECTOR_ENCRYPTION_KEY")) {
    return { status: "setup_required", reason: "encryption_key" };
  }
  const requestOrigin = new URL(input.requestUrl).origin;
  const configuredOrigin = canonicalHttpsOrigin(
    runtimeValue("PRODUCTION_SITE_URL") ?? runtimeValue("SITE_URL"),
  );
  if (!configuredOrigin || requestOrigin !== configuredOrigin) {
    return { status: "setup_required", reason: "origin" };
  }

  const id = crypto.randomUUID();
  const secret = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hashPromotionToken(id, secret);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CODE_WINDOW_MS).toISOString();
  const code = `${CODE_VERSION}.${encodeJson({ id, origin: configuredOrigin })}.${secret}`;

  await prunePromotionTransactions(database);
  await database
    .prepare(
      `INSERT INTO play_promotion_transactions (
         id, token_hash, owner_email, target_origin, status, attempts,
         providers_json, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'issued', 0, '[]', ?, ?, ?)`,
    )
    .bind(
      id,
      tokenHash,
      input.ownerEmail.trim().toLowerCase(),
      configuredOrigin,
      expiresAt,
      createdAt,
      createdAt,
    )
    .run();

  return { status: "issued", code, expiresAt, targetOrigin: configuredOrigin };
}

async function storedPromotion(
  database: D1Database,
  id: string,
): Promise<StoredPromotion | null> {
  return database
    .prepare(
      `SELECT id, token_hash AS tokenHash, owner_email AS ownerEmail,
              target_origin AS targetOrigin, status, attempts, ciphertext, iv,
              key_version AS keyVersion, providers_json AS providersJson,
              expires_at AS expiresAt, staged_expires_at AS stagedExpiresAt,
              created_at AS createdAt
       FROM play_promotion_transactions
       WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<StoredPromotion>();
}

async function recoverPlayPromotionLock(
  database: D1Database,
  row: Pick<StoredPromotion, "id" | "ownerEmail">,
): Promise<void> {
  const now = new Date().toISOString();
  const reset = await database
    .prepare(
      `UPDATE play_promotion_transactions
       SET status = 'staged', updated_at = ?
       WHERE id = ? AND owner_email = ? AND status = 'applying'
         AND staged_expires_at > ?`,
    )
    .bind(now, row.id, row.ownerEmail, now)
    .run();
  if ((reset.meta.changes ?? 0) === 1) return;

  await database
    .prepare(
      `UPDATE play_promotion_transactions
       SET status = 'expired', ciphertext = NULL, iv = NULL,
           key_version = NULL, updated_at = ?
       WHERE id = ? AND owner_email = ? AND status = 'applying'
         AND staged_expires_at <= ?`,
    )
    .bind(now, row.id, row.ownerEmail, now)
    .run();
}

export async function stagePlayPromotion(input: {
  transferCode: unknown;
  payload: unknown;
  requestUrl: string;
}): Promise<
  | { status: "staged"; id: string; providers: PromotionSummary["providers"] }
  | { status: "invalid" | "expired" | "already_used" | "setup_required" }
> {
  const parsed = parsePromotionCode(input.transferCode);
  if (!parsed || !validPortablePayload(input.payload)) {
    return { status: "invalid" };
  }
  const requestOrigin = new URL(input.requestUrl).origin;
  if (requestOrigin !== parsed.payload.origin) return { status: "invalid" };

  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!database || !encryptionKey) return { status: "setup_required" };
  const row = await storedPromotion(database, parsed.payload.id);
  if (!row || row.targetOrigin !== requestOrigin) return { status: "invalid" };
  if (row.status !== "issued") return { status: "already_used" };
  if (row.attempts >= MAX_ATTEMPTS || Date.parse(row.expiresAt) <= Date.now()) {
    return { status: "expired" };
  }

  const candidateHash = await hashPromotionToken(row.id, parsed.secret);
  if (!constantTimeTextEqual(candidateHash, row.tokenHash)) {
    await database
      .prepare(
        `UPDATE play_promotion_transactions
         SET attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'issued' AND attempts < ?`,
      )
      .bind(new Date().toISOString(), row.id, MAX_ATTEMPTS)
      .run();
    return { status: "invalid" };
  }

  const providers = providerNames(input.payload);
  const encrypted = await encryptCredential(
    input.payload,
    encryptionKey,
    `${PROMOTION_CONTEXT_PREFIX}:${row.id}`,
  );
  const now = new Date().toISOString();
  const stagedExpiresAt = new Date(Date.now() + STAGED_WINDOW_MS).toISOString();
  const result = await database
    .prepare(
      `UPDATE play_promotion_transactions
       SET status = 'staged', attempts = attempts + 1, ciphertext = ?, iv = ?,
           key_version = ?, providers_json = ?, staged_expires_at = ?,
           consumed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'issued' AND attempts < ? AND expires_at > ?`,
    )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.keyVersion,
      JSON.stringify(providers),
      stagedExpiresAt,
      now,
      now,
      row.id,
      MAX_ATTEMPTS,
      now,
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) return { status: "already_used" };

  return { status: "staged", id: row.id, providers };
}

function validProviderList(value: string): PromotionSummary["providers"] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (provider): provider is PromotionSummary["providers"][number] =>
        provider === "hardcover" || provider === "steam" || provider === "strava",
    );
  } catch {
    return [];
  }
}

export async function listPlayPromotions(
  ownerEmail: string,
): Promise<PromotionSummary[]> {
  const database = databaseOrNull();
  if (!database) return [];
  await prunePromotionTransactions(database);
  const now = new Date().toISOString();
  const rows = await database
    .prepare(
      `SELECT id, status, providers_json AS providersJson,
              created_at AS createdAt,
              COALESCE(staged_expires_at, expires_at) AS expiresAt
       FROM play_promotion_transactions
       WHERE owner_email = ?
         AND status IN ('staged', 'applying', 'applied')
         AND (status = 'applied' OR staged_expires_at > ?)
       ORDER BY created_at DESC
       LIMIT 8`,
    )
    .bind(ownerEmail.trim().toLowerCase(), now)
    .all<{
      id: string;
      status: "staged" | "applying" | "applied";
      providersJson: string;
      createdAt: string;
      expiresAt: string;
    }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    providers: validProviderList(row.providersJson),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }));
}

async function loadPortableCredentials(): Promise<PortablePlayPayload | null> {
  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!database || !encryptionKey) return null;
  const rows = await database
    .prepare(
      `SELECT provider, ciphertext, iv, key_version AS keyVersion
       FROM connector_credentials
       WHERE provider IN ('hardcover', 'steam')`,
    )
    .all<{
      provider: string;
      ciphertext: string;
      iv: string;
      keyVersion: "v1";
    }>();

  const providers: PortablePlayPayload["providers"] = {};
  for (const row of rows.results ?? []) {
    if (row.provider !== "hardcover" && row.provider !== "steam") continue;
    try {
      const credential = await decryptCredential<HardcoverCredential | SteamCredential>(
        row,
        encryptionKey,
        row.provider,
      );
      if (
        row.provider === "hardcover" &&
        "authorization" in credential &&
        normalizeHardcoverAuthorization(credential.authorization)
      ) {
        providers.hardcover = {
          authorization: normalizeHardcoverAuthorization(credential.authorization)!,
        };
      }
      if (
        row.provider === "steam" &&
        "apiKey" in credential &&
        "steamId" in credential
      ) {
        const apiKey = normalizeSteamApiKey(credential.apiKey);
        const steamId = normalizeSteamId(credential.steamId);
        if (apiKey && steamId) providers.steam = { apiKey, steamId };
      }
    } catch {
      // An unreadable local credential is omitted rather than copied.
    }
  }
  const strava = await getStravaPortableConfig(database);
  if (strava) providers.strava = strava;
  if (Object.keys(providers).length === 0) return null;
  return {
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    providers,
  };
}

export async function sendLocalPlayPromotion(input: {
  transferCode: unknown;
  requestUrl: string;
}): Promise<
  | { status: "staged"; id: string; providers: PromotionSummary["providers"] }
  | { status: "invalid_code" | "no_credentials" | "setup_required" | "remote_error" }
> {
  const parsed = parsePromotionCode(input.transferCode);
  const productionOrigin = canonicalHttpsOrigin(runtimeValue("PRODUCTION_SITE_URL"));
  const requestHost = new URL(input.requestUrl).hostname;
  if (
    !parsed ||
    !productionOrigin ||
    parsed.payload.origin !== productionOrigin ||
    !["localhost", "127.0.0.1", "::1"].includes(requestHost)
  ) {
    return { status: "invalid_code" };
  }
  const payload = await loadPortableCredentials();
  if (!payload) return { status: "no_credentials" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${productionOrigin}/api/play-promotion/import`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "user-agent": "anish-site-local-promotion/1",
      },
      body: JSON.stringify({ transferCode: input.transferCode, payload }),
      signal: controller.signal,
    });
    if (!response.ok || response.status >= 300) return { status: "remote_error" };
    const result = (await response.json()) as unknown;
    if (
      typeof result !== "object" ||
      result === null ||
      !("status" in result) ||
      result.status !== "staged" ||
      !("id" in result) ||
      typeof result.id !== "string" ||
      !("providers" in result) ||
      !Array.isArray(result.providers)
    ) {
      return { status: "remote_error" };
    }
    return {
      status: "staged",
      id: result.id,
      providers: result.providers.filter(
        (provider): provider is PromotionSummary["providers"][number] =>
          provider === "hardcover" || provider === "steam" || provider === "strava",
      ),
    };
  } catch {
    return { status: "remote_error" };
  } finally {
    clearTimeout(timeout);
  }
}

function samePortableApiCredential(
  provider: "hardcover" | "steam",
  current: HardcoverCredential | SteamCredential,
  next: HardcoverCredential | SteamCredential,
): boolean {
  return provider === "hardcover"
    ? (current as HardcoverCredential).authorization ===
        (next as HardcoverCredential).authorization
    : (current as SteamCredential).apiKey ===
        (next as SteamCredential).apiKey &&
        (current as SteamCredential).steamId ===
          (next as SteamCredential).steamId;
}

async function importPortableApiCredential(
  provider: "hardcover" | "steam",
  credential: HardcoverCredential | SteamCredential,
  actorEmail: string,
): Promise<PromotionProviderOutcome> {
  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!database || !encryptionKey) {
    return { provider, status: "failed", code: "setup_required" };
  }
  if (provider === "steam" && !steamStorageCountries()) {
    return { provider, status: "failed", code: "storage_disclosure" };
  }

  let normalized: HardcoverCredential | SteamCredential;
  try {
    if (provider === "hardcover") {
      const authorization = normalizeHardcoverAuthorization(
        (credential as HardcoverCredential).authorization,
      );
      if (!authorization) throw new Error("invalid credential");
      normalized = { authorization };
    } else {
      const candidate = credential as SteamCredential;
      const apiKey = normalizeSteamApiKey(candidate.apiKey);
      const steamId = normalizeSteamId(candidate.steamId);
      if (!apiKey || !steamId) throw new Error("invalid credential");
      normalized = { apiKey, steamId };
    }
  } catch {
    return { provider, status: "failed", code: "invalid_credential" };
  }

  try {
    const current = await loadCredential(database, provider);
    if (
      current &&
      samePortableApiCredential(
        provider,
        current.credential as HardcoverCredential | SteamCredential,
        normalized,
      )
    ) {
      return { provider, status: "applied" };
    }
  } catch {
    return { provider, status: "failed", code: "credential_unavailable" };
  }

  // This import intentionally stores no provider data. The credential helper
  // increments the generation and removes snapshots from the prior account so
  // they cannot remain public under a replacement credential. Studio's
  // explicit Refresh action is the only operation that may publish a new
  // collection snapshot.
  const saved = await saveConnectorCredential(
    provider,
    provider === "hardcover"
      ? (normalized as HardcoverCredential).authorization
      : (normalized as SteamCredential),
    actorEmail,
  );
  return saved.status === "saved"
    ? { provider, status: "applied" }
    : {
        provider,
        status: "failed",
        code:
          saved.status === "invalid"
            ? "invalid_credential"
            : saved.reason,
      };
}

export async function applyPlayPromotion(input: {
  id: string;
  ownerEmail: string;
}): Promise<
  | { status: "complete"; outcomes: PromotionProviderOutcome[] }
  | { status: "not_found" | "expired" | "already_used" | "setup_required" }
> {
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { status: "not_found" };
  const database = databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!database || !encryptionKey) return { status: "setup_required" };
  const row = await storedPromotion(database, input.id);
  if (!row || row.ownerEmail !== input.ownerEmail.trim().toLowerCase()) {
    return { status: "not_found" };
  }
  if (row.status !== "staged") return { status: "already_used" };
  if (!row.stagedExpiresAt || Date.parse(row.stagedExpiresAt) <= Date.now()) {
    return { status: "expired" };
  }
  if (!row.ciphertext || !row.iv || row.keyVersion !== "v1") {
    return { status: "setup_required" };
  }
  const lock = await database
    .prepare(
      `UPDATE play_promotion_transactions
       SET status = 'applying', updated_at = ?
       WHERE id = ? AND owner_email = ? AND status = 'staged'
         AND staged_expires_at > ?`,
    )
    .bind(
      new Date().toISOString(),
      row.id,
      input.ownerEmail.trim().toLowerCase(),
      new Date().toISOString(),
    )
    .run();
  if ((lock.meta.changes ?? 0) !== 1) return { status: "already_used" };

  try {
    const payload = await decryptCredential<PortablePlayPayload>(
      { ciphertext: row.ciphertext, iv: row.iv, keyVersion: "v1" },
      encryptionKey,
      `${PROMOTION_CONTEXT_PREFIX}:${row.id}`,
    );
    const outcomes: PromotionProviderOutcome[] = [];
    if (payload.providers.hardcover) {
      outcomes.push(
        await importPortableApiCredential(
          "hardcover",
          payload.providers.hardcover,
          input.ownerEmail,
        ),
      );
    }
    if (payload.providers.steam) {
      outcomes.push(
        await importPortableApiCredential(
          "steam",
          payload.providers.steam,
          input.ownerEmail,
        ),
      );
    }
    if (payload.providers.strava) {
      const result = await applyStravaPortableConfig(
        payload.providers.strava,
        input.ownerEmail,
        database,
      );
      outcomes.push(
        result.status === "saved"
          ? { provider: "strava", status: "applied" }
          : { provider: "strava", status: "failed", code: result.code },
      );
    }

    const finishedAt = new Date().toISOString();
    await database.batch([
      database
        .prepare(
          `UPDATE play_promotion_transactions
           SET status = 'applied', ciphertext = NULL, iv = NULL,
               key_version = NULL, updated_at = ?
           WHERE id = ? AND status = 'applying'`,
        )
        .bind(finishedAt, row.id),
      database
        .prepare(
          `INSERT INTO audit_log (
             id, actor_email, action, entity_type, entity_id, details_json, created_at
           ) VALUES (?, ?, 'connector.promotion_completed', 'play_promotion', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.ownerEmail,
          row.id,
          JSON.stringify({
            outcomes: outcomes.map(({ provider, status, code }) => ({
              provider,
              status,
              ...(code === undefined ? {} : { code }),
            })),
          }),
          finishedAt,
        ),
    ]);
    return { status: "complete", outcomes };
  } catch (error) {
    try {
      await recoverPlayPromotionLock(database, row);
    } catch {
      // Preserve the original provider or D1 error. A later retention pass can
      // still expire an unrecoverable transaction without exposing its payload.
    }
    throw error;
  }
}

export const playPromotionInternals = {
  canonicalHttpsOrigin,
  parsePromotionCode,
  validPortablePayload,
};
