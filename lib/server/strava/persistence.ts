import { runtimeDatabase } from "../runtime-env";
import {
  connectorPublicationApprovalPendingSettingKey,
  connectorPublicationApprovalPendingValue,
  connectorPublicationApprovalSettingKey,
  connectorPublicationGate,
} from "../connectors/publication-approval";

export const STRAVA_SETTING_KEY = "connector.strava.public_embed";
const HEALTH_CHECK_WINDOW_MS = 12 * 60 * 60 * 1_000;
import type { StoredStravaConfig, StravaConfigResult, StravaHealthResult, StravaPortableConfig, StravaDiagnostic } from "./types";
import { normalizeStravaEmbed, normalizeStravaProfileUrl, isStravaPortableConfig } from "./parser";
import { verifyStravaEmbed } from "./verification";
import { projectStravaConfig } from "./projection";
export type { StravaEmbedKind, StravaPublicConfig, StravaPortableConfig, StravaConfigResult, StravaEmbedValidation, StravaHealthResult } from "./types";
export { normalizeStravaEmbed, normalizeStravaProfileUrl, isStravaPortableConfig } from "./parser";
export { verifyStravaEmbed } from "./verification";

type EditorialSettingRow = { valueJson: string };

function isCanonicalIsoDateTime(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function databaseOrNull(
  database: D1Database | null | undefined,
): D1Database | null {
  return database === undefined ? runtimeDatabase() : database;
}

function parseStored(value: string): StoredStravaConfig | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const profileUrl = normalizeStravaProfileUrl(record.profileUrl);
  if (!profileUrl || profileUrl !== record.profileUrl) {
    const legacyEmbed = normalizeStravaEmbed(record.embedUrl);
    if (
      legacyEmbed.ok &&
      legacyEmbed.inferredProfileUrl &&
      typeof record.updatedAt === "string" &&
      isCanonicalIsoDateTime(record.updatedAt)
    ) {
      return {
        profileUrl: legacyEmbed.inferredProfileUrl,
        embedUrl: legacyEmbed.embedUrl,
        embedKind: legacyEmbed.kind,
        embedStatus: "unavailable",
        checkedAt: record.updatedAt,
        updatedAt: record.updatedAt,
      };
    }
    return null;
  }
  if (
    (record.embedStatus !== "available" && record.embedStatus !== "unavailable") ||
    typeof record.updatedAt !== "string" ||
    !isCanonicalIsoDateTime(record.updatedAt) ||
    (record.checkedAt !== null &&
      (typeof record.checkedAt !== "string" || !isCanonicalIsoDateTime(record.checkedAt)))
  ) {
    return null;
  }
  if (record.embedUrl === null && record.embedKind === null) {
    return {
      profileUrl,
      embedUrl: null,
      embedKind: null,
      embedStatus: "unavailable",
      checkedAt: null,
      updatedAt: record.updatedAt,
    };
  }
  const embed = normalizeStravaEmbed(record.embedUrl);
  if (
    !embed.ok ||
    embed.embedUrl !== record.embedUrl ||
    embed.kind !== record.embedKind ||
    (record.embedStatus === "available" &&
      typeof record.checkedAt !== "string")
  ) {
    return null;
  }
  return {
    profileUrl,
    embedUrl: embed.embedUrl,
    embedKind: embed.kind,
    embedStatus: record.embedStatus,
    checkedAt: record.checkedAt,
    updatedAt: record.updatedAt,
    ...(isStravaDiagnostic(record.diagnostic) ? { diagnostic: record.diagnostic } : {}),
  };
}

function isStravaDiagnostic(value: unknown): value is StravaDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 5 && record.schemaVersion === 1 &&
    ["headers_permit", "redirected", "framing_blocked", "provider_error", "legacy_format", "invalid_embed"].includes(String(record.result)) &&
    ["csp", "x-frame-options", "none"].includes(String(record.policy)) &&
    (record.httpStatus === null || (Number.isInteger(record.httpStatus) && Number(record.httpStatus) >= 100 && Number(record.httpStatus) <= 599)) &&
    record.visuallyVerified === false;
}

/** Owner-only diagnostics. Never part of public or portable projections. */
export async function getStravaOwnerDiagnostics(database?: D1Database | null) {
  const stored = await readStoredConfig(database);
  return stored && stored !== "database_unavailable"
    ? { checkedAt: stored.checkedAt, diagnostic: stored.diagnostic ?? null }
    : { checkedAt: null, diagnostic: null };
}

async function readStoredConfig(
  database?: D1Database | null,
): Promise<StoredStravaConfig | null | "database_unavailable"> {
  const binding = databaseOrNull(database);
  if (!binding) return "database_unavailable";
  try {
    const row = await binding
      .prepare(
        `SELECT value_json AS valueJson FROM editorial_settings WHERE key = ? LIMIT 1`,
      )
      .bind(STRAVA_SETTING_KEY)
      .first<EditorialSettingRow>();
    return row ? parseStored(row.valueJson) : null;
  } catch {
    return "database_unavailable";
  }
}

export async function getStravaPublicConfig(
  database?: D1Database | null,
  options: { bypassPublicationApproval?: boolean } = {},
): Promise<StravaConfigResult> {
  const storedResult = await readStoredConfig(database);
  if (storedResult === "database_unavailable") {
    return { status: "unavailable", reason: "database_unavailable" };
  }
  if (storedResult === null) {
    return { status: "unavailable", reason: "not_configured" };
  }
  const stored = storedResult;
  if (!options.bypassPublicationApproval) {
    const gate = await connectorPublicationGate(
      "strava",
      databaseOrNull(database),
    );
    if (gate.status === "setup_required") {
      return { status: "unavailable", reason: "database_unavailable" };
    }
    if (gate.status === "withheld") {
      return { status: "unavailable", reason: "visibility_withheld" };
    }
  }
  return projectStravaConfig(stored);
}

export async function verifyStoredStravaPublicConfig(
  actorEmail: string,
  database?: D1Database | null,
  siteOrigin?: string,
): Promise<
  | {
      status: "verified";
      provider: "strava";
      embedStatus: "available" | "unavailable";
      checkedAt: string;
      diagnostic?: StravaDiagnostic;
    }
  | {
      status: "not_configured";
      provider: "strava";
      reason: "config" | "embed";
    }
  | { status: "conflict"; provider: "strava" }
  | { status: "setup_required"; provider: "strava" }
> {
  const stored = await readStoredConfig(database);
  if (stored === "database_unavailable") {
    return { status: "setup_required", provider: "strava" };
  }
  if (!stored) {
    return { status: "not_configured", provider: "strava", reason: "config" };
  }
  if (!stored.embedUrl || !stored.embedKind) {
    return { status: "not_configured", provider: "strava", reason: "embed" };
  }

  const binding = databaseOrNull(database);
  if (!binding) return { status: "setup_required", provider: "strava" };
  const health = await verifyStravaEmbed(stored.embedUrl, fetch, siteOrigin);
  const verified: StoredStravaConfig = {
    ...stored,
    embedStatus: health.status,
    checkedAt: health.checkedAt,
    diagnostic: health.diagnostic,
  };
  try {
    const update = await binding
      .prepare(
        `UPDATE editorial_settings
         SET value_json = ?, updated_at = ?
         WHERE key = ? AND value_json = ?`,
      )
      .bind(
        JSON.stringify(verified),
        health.checkedAt,
        STRAVA_SETTING_KEY,
        JSON.stringify(stored),
      )
      .run();
    if ((update.meta.changes ?? 0) !== 1) {
      return { status: "conflict", provider: "strava" };
    }
    await binding
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id,
           details_json, created_at
         ) VALUES (?, ?, 'connector.embed_verified', 'connector', 'strava', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        JSON.stringify({ embedStatus: health.status }),
        health.checkedAt,
      )
      .run();
  } catch {
    return { status: "setup_required", provider: "strava" };
  }
  return {
    status: "verified",
    provider: "strava",
    embedStatus: health.status,
    checkedAt: health.checkedAt,
    diagnostic: health.diagnostic,
  };
}

export async function getStravaPortableConfig(
  database?: D1Database | null,
): Promise<StravaPortableConfig | null> {
  const stored = await readStoredConfig(database);
  if (!stored || stored === "database_unavailable") return null;
  return {
    profileUrl: stored.profileUrl,
    embedUrl: stored.embedUrl,
    embedKind: stored.embedKind,
  };
}

type PreparedStravaConfig = {
  stored: StoredStravaConfig;
  health: StravaHealthResult | null;
};

async function prepareStravaConfig(
  input: unknown,
  previous: StoredStravaConfig | null = null,
  forceHealthCheck = false,
  siteOrigin?: string,
): Promise<
  | { ok: true; value: PreparedStravaConfig }
  | { ok: false; code: "invalid_embed" | "invalid_profile"; message: string }
> {
  const record =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : { embed: input };
  const embedInput = record.embed ?? record.embedUrl;
  const normalizedEmbed =
    embedInput === undefined || embedInput === null || embedInput === ""
      ? null
      : normalizeStravaEmbed(embedInput);
  if (normalizedEmbed && !normalizedEmbed.ok) return normalizedEmbed;
  const profileUrl = normalizeStravaProfileUrl(
    record.profileUrl ?? normalizedEmbed?.inferredProfileUrl,
  );
  if (!profileUrl) {
    return {
      ok: false,
      code: "invalid_profile",
      message: "Enter the public Strava athlete profile URL that visitors can open when the feed is unavailable.",
    };
  }
  const previousCheckTime = previous?.checkedAt
    ? Date.parse(previous.checkedAt)
    : Number.NaN;
  const canReuseHealth =
    !forceHealthCheck &&
    normalizedEmbed !== null &&
    previous?.embedUrl === normalizedEmbed.embedUrl &&
    Number.isFinite(previousCheckTime) &&
    Date.now() - previousCheckTime < HEALTH_CHECK_WINDOW_MS;
  const health = normalizedEmbed
    ? canReuseHealth
      ? previous?.embedStatus === "available"
        ? { status: "available" as const, checkedAt: previous.checkedAt as string, diagnostic: previous.diagnostic }
        : {
            status: "unavailable" as const,
            checkedAt: previous?.checkedAt as string,
            reason: "provider_error" as const,
            diagnostic: previous?.diagnostic,
          }
      : await verifyStravaEmbed(normalizedEmbed.embedUrl, fetch, siteOrigin)
    : null;
  const updatedAt = new Date().toISOString();
  return {
    ok: true,
    value: {
      health,
      stored: {
        profileUrl,
        embedUrl: normalizedEmbed?.embedUrl ?? null,
        embedKind: normalizedEmbed?.kind ?? null,
        embedStatus: health?.status === "available" ? "available" : "unavailable",
        checkedAt: health?.checkedAt ?? null,
        updatedAt,
        ...(health?.diagnostic ? { diagnostic: health.diagnostic } : {}),
      },
    },
  };
}

async function writePreparedStravaConfig(
  prepared: PreparedStravaConfig,
  actorEmail: string,
  database?: D1Database | null,
  previous: StoredStravaConfig | null = null,
) {
  const binding = databaseOrNull(database);
  if (!binding) throw new Error("D1 database binding is unavailable.");
  const { stored } = prepared;
  const accountChanged =
    previous === null || previous.profileUrl !== stored.profileUrl;
  await binding.batch([
    binding
      .prepare(
        `INSERT INTO editorial_settings (key, value_json, updated_by_email, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
           updated_by_email = excluded.updated_by_email, updated_at = excluded.updated_at`,
      )
      .bind(STRAVA_SETTING_KEY, JSON.stringify(stored), actorEmail, stored.updatedAt),
    ...(accountChanged
      ? [
          binding
            .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
            .bind(connectorPublicationApprovalSettingKey("strava")),
          binding
            .prepare(
              `INSERT INTO editorial_settings (
                 key, value_json, updated_by_email, updated_at
               ) VALUES (?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 value_json = excluded.value_json,
                 updated_by_email = excluded.updated_by_email,
                 updated_at = excluded.updated_at`,
            )
            .bind(
              connectorPublicationApprovalPendingSettingKey("strava"),
              connectorPublicationApprovalPendingValue(
                "strava",
                stored.updatedAt,
              ),
              actorEmail,
              stored.updatedAt,
            ),
        ]
      : []),
    binding
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, 'connector.config_saved', 'connector', 'strava', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        JSON.stringify({
          configuration: stored.embedKind ? "profile_and_embed" : "profile_link",
          embedStatus: stored.embedStatus,
        }),
        stored.updatedAt,
      ),
  ]);
  return {
    status: "saved" as const,
    provider: "strava" as const,
    profileUrl: stored.profileUrl,
    embedUrl: stored.embedUrl,
    embedKind: stored.embedKind,
    embedStatus: stored.embedStatus,
    checkedAt: stored.checkedAt,
    updatedAt: stored.updatedAt,
    diagnostic: stored.diagnostic,
  };
}

export async function saveStravaPublicConfig(
  input: unknown,
  actorEmail: string,
  database?: D1Database | null,
  siteOrigin?: string,
) {
  const current = await readStoredConfig(database);
  const prepared = await prepareStravaConfig(
    input,
    current && current !== "database_unavailable" ? current : null,
    false,
    siteOrigin,
  );
  if (!prepared.ok) return prepared;
  return writePreparedStravaConfig(
    prepared.value,
    actorEmail,
    database,
    current && current !== "database_unavailable" ? current : null,
  );
}

export async function applyStravaPortableConfig(
  input: StravaPortableConfig,
  actorEmail: string,
  database?: D1Database | null,
): Promise<
  | Awaited<ReturnType<typeof writePreparedStravaConfig>>
  | { status: "failed"; ok: false; code: string; message: string }
> {
  if (!isStravaPortableConfig(input)) {
    return {
      status: "failed",
      ok: false,
      code: "invalid_config",
      message: "The promoted Strava configuration is invalid.",
    };
  }

  const current = await readStoredConfig(database);
  if (current === "database_unavailable") {
    return {
      status: "failed",
      ok: false,
      code: "setup_required",
      message: "The site database is not ready.",
    };
  }
  if (
    current &&
    current.profileUrl === input.profileUrl &&
    current.embedUrl === input.embedUrl &&
    current.embedKind === input.embedKind
  ) {
    return {
      status: "saved" as const,
      provider: "strava" as const,
      profileUrl: current.profileUrl,
      embedUrl: current.embedUrl,
      embedKind: current.embedKind,
      embedStatus: current.embedStatus,
      checkedAt: current.checkedAt,
      updatedAt: current.updatedAt,
      diagnostic: current.diagnostic,
    };
  }

  // Promotion imports only the reviewed portable shape. A new or changed
  // widget remains unavailable until the owner explicitly uses Verify in
  // Studio; importing settings must never contact Strava.
  const updatedAt = new Date().toISOString();
  return writePreparedStravaConfig(
    {
      health: null,
      stored: {
        profileUrl: input.profileUrl,
        embedUrl: input.embedUrl,
        embedKind: input.embedKind,
        embedStatus: "unavailable",
        checkedAt: null,
        updatedAt,
      },
    },
    actorEmail,
    database,
    current,
  );
}

export async function deleteStravaPublicConfig(
  actorEmail: string,
  database?: D1Database | null,
): Promise<{
  status: "disconnected";
  provider: "strava";
  configDeleted: true;
  snapshotsDeleted: true;
  syncHistoryDeleted: true;
}> {
  const binding = databaseOrNull(database);
  if (!binding) throw new Error("D1 database binding is unavailable.");
  const deletedAt = new Date().toISOString();
  await binding.batch([
    binding.prepare(`DELETE FROM editorial_settings WHERE key = ?`).bind(STRAVA_SETTING_KEY),
    binding
      .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
      .bind(connectorPublicationApprovalSettingKey("strava")),
    binding
      .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
      .bind(connectorPublicationApprovalPendingSettingKey("strava")),
    binding.prepare(`DELETE FROM connector_credentials WHERE provider = 'strava'`),
    binding.prepare(`DELETE FROM connector_snapshots WHERE provider = 'strava'`),
    binding.prepare(`DELETE FROM sync_runs WHERE provider = 'strava'`),
    binding.prepare(`DELETE FROM audit_log WHERE entity_type = 'connector' AND entity_id = 'strava'`),
    binding
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, 'connector.config_deleted', 'connector', 'strava', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        JSON.stringify({
          configDeleted: true,
          snapshotsDeleted: true,
          syncHistoryDeleted: true,
        }),
        deletedAt,
      ),
  ]);
  return {
    status: "disconnected",
    provider: "strava",
    configDeleted: true,
    snapshotsDeleted: true,
    syncHistoryDeleted: true,
  };
}
