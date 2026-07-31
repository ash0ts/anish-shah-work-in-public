import { runtimeDatabase } from "./runtime-env";

const STRAVA_SETTING_KEY = "connector.strava.public_embed";
const STRAVA_EMBED_HOST = "strava-embeds.com";
const STRAVA_PROFILE_HOST = "www.strava.com";
const STRAVA_PROFILE_PATH = /^\/athletes\/([1-9]\d{0,19})\/?$/;
const STRAVA_PROFILE_EMBED_PATH =
  /^\/athletes\/([1-9]\d{0,19})\/(latest-rides|activity-summary)\/([a-f0-9]{40})\/?$/i;
const STRAVA_CURRENT_EMBED_PATH = /^\/(activity|route)\/([1-9]\d{0,24})\/?$/;
const STRAVA_MODERN_SCRIPT_URL = "https://strava-embeds.com/embed.js";
const MAX_INPUT_LENGTH = 8_192;
const MAX_URL_LENGTH = 2_048;
const HEALTH_CHECK_TIMEOUT_MS = 6_000;
const HEALTH_CHECK_WINDOW_MS = 12 * 60 * 60 * 1_000;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const UNSAFE_MARKUP_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type StravaEmbedKind =
  | "profile_feed"
  | "profile_summary"
  | "activity"
  | "route";

export type StravaPublicConfig = {
  provider: "strava";
  profileUrl: string;
  embed: {
    kind: StravaEmbedKind;
    embedUrl: string;
    checkedAt: string;
  } | null;
  embedStatus: "available" | "unavailable";
  updatedAt: string;
};

export type StravaPortableConfig = {
  profileUrl: string;
  embedUrl: string | null;
  embedKind: StravaEmbedKind | null;
};

type StoredStravaConfig = StravaPortableConfig & {
  embedStatus: "available" | "unavailable";
  checkedAt: string | null;
  updatedAt: string;
};

export type StravaConfigResult =
  | { status: "ready"; config: StravaPublicConfig }
  | {
      status: "unavailable";
      reason: "database_unavailable" | "not_configured" | "invalid_config";
    };

export type StravaEmbedValidation =
  | {
      ok: true;
      embedUrl: string;
      kind: StravaEmbedKind;
      inferredProfileUrl: string | null;
    }
  | { ok: false; code: "invalid_embed"; message: string };

export type StravaHealthResult =
  | { status: "available"; checkedAt: string }
  | {
      status: "unavailable";
      checkedAt: string;
      reason: "redirected" | "not_frameable" | "provider_error";
    };

type EditorialSettingRow = { valueJson: string };

function isCanonicalIsoDateTime(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function unavailableEmbed(message: string): StravaEmbedValidation {
  return { ok: false, code: "invalid_embed", message };
}

function parseAttributes(value: string): Map<string, string | null> | null {
  const attributes = new Map<string, string | null>();
  const pattern =
    /\s*([A-Za-z_:][A-Za-z0-9:._-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
  let offset = 0;
  while (offset < value.length) {
    if (!value.slice(offset).trim()) break;
    pattern.lastIndex = offset;
    const match = pattern.exec(value);
    if (!match || match.index !== offset || pattern.lastIndex === offset) {
      return null;
    }
    const name = match[1].toLowerCase();
    if (attributes.has(name)) return null;
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? null);
    offset = pattern.lastIndex;
  }
  return attributes;
}

function canonicalCurrentEmbed(
  type: "activity" | "route",
  id: string,
  fullWidth = false,
): string {
  const search = new URLSearchParams();
  search.set("fromEmbed", "true");
  if (type === "route" && fullWidth) search.set("fullWidth", "true");
  search.set("style", "standard");
  return `https://${STRAVA_EMBED_HOST}/${type}/${id}?${search.toString()}`;
}

function modernPlaceholderSource(value: string): string | null {
  const match = value.match(
    /^<div\b([^>]*)>\s*<\/div>\s*<script\b([^>]*)>\s*<\/script>$/i,
  );
  if (!match) return null;
  const placeholder = parseAttributes(match[1]);
  const script = parseAttributes(match[2]);
  if (!placeholder || !script) return null;

  const placeholderKeys = new Set([
    "class",
    "data-embed-id",
    "data-embed-type",
    "data-elevation-gain",
    "data-elevation-profile",
    "data-distance",
    "data-from-embed",
    "data-full-width",
    "data-map-hash",
    "data-slippy",
    "data-style",
    "data-surface-type",
    "data-units",
  ]);
  const scriptKeys = new Set(["async", "defer", "src", "type"]);
  if (
    [...placeholder.keys()].some((key) => !placeholderKeys.has(key)) ||
    [...script.keys()].some((key) => !scriptKeys.has(key)) ||
    placeholder.get("class") !== "strava-embed-placeholder" ||
    script.get("src") !== STRAVA_MODERN_SCRIPT_URL
  ) {
    return null;
  }

  const type = placeholder.get("data-embed-type");
  const id = placeholder.get("data-embed-id");
  const fullWidth = placeholder.get("data-full-width");
  if (
    (type !== "activity" && type !== "route") ||
    !id ||
    !/^[1-9]\d{0,24}$/.test(id) ||
    (fullWidth !== undefined && fullWidth !== "true" && fullWidth !== "false") ||
    (type !== "route" && fullWidth !== undefined)
  ) {
    return null;
  }
  return canonicalCurrentEmbed(type, id, fullWidth === "true");
}

function iframeSource(value: string): string | null {
  if (!value.startsWith("<")) return value;
  const iframe = value.match(/^<iframe\b([^>]*)>\s*<\/iframe>$/i);
  if (!iframe) return null;
  const attributes = parseAttributes(iframe[1]);
  if (!attributes) return null;
  const allowed = new Set([
    "allowfullscreen",
    "allowtransparency",
    "frameborder",
    "height",
    "loading",
    "referrerpolicy",
    "scrolling",
    "src",
    "style",
    "title",
    "width",
  ]);
  if ([...attributes.keys()].some((key) => !allowed.has(key))) return null;
  const source = attributes.get("src");
  return typeof source === "string" ? source : null;
}

export function normalizeStravaProfileUrl(input: unknown): string | null {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > MAX_URL_LENGTH ||
    CONTROL_CHARACTER.test(input)
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== STRAVA_PROFILE_HOST ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !STRAVA_PROFILE_PATH.test(url.pathname)
  ) {
    return null;
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function canonicalizeCurrentEmbed(url: URL): string | null {
  const match = url.pathname.match(STRAVA_CURRENT_EMBED_PATH);
  if (!match) return null;
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === "style" && value === "standard") continue;
    if (key === "fromEmbed" && (value === "true" || value === "false")) continue;
    if (
      key === "fullWidth" &&
      match[1] === "route" &&
      (value === "true" || value === "false")
    ) {
      continue;
    }
    return null;
  }
  return canonicalCurrentEmbed(
    match[1] as "activity" | "route",
    match[2],
    url.searchParams.get("fullWidth") === "true",
  );
}

export function normalizeStravaEmbed(input: unknown): StravaEmbedValidation {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > MAX_INPUT_LENGTH ||
    UNSAFE_MARKUP_CONTROL.test(input)
  ) {
    return unavailableEmbed("Paste one complete official Strava embed.");
  }
  const trimmed = input.trim();
  const modernSource = modernPlaceholderSource(trimmed);
  const source = modernSource ?? iframeSource(trimmed);
  if (!source || source.length > MAX_URL_LENGTH || CONTROL_CHARACTER.test(source)) {
    return unavailableEmbed("The embed must contain one official Strava source URL.");
  }

  let url: URL;
  try {
    url = new URL(source.replaceAll("&amp;", "&"));
  } catch {
    return unavailableEmbed("The Strava embed URL is malformed.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i.test(url.toString())
  ) {
    return unavailableEmbed(
      "Use an HTTPS Strava embed without credentials, a port, or a fragment.",
    );
  }

  if (url.hostname.toLowerCase() === STRAVA_PROFILE_HOST) {
    if (url.search) return unavailableEmbed("Profile widgets must use the exact Strava-generated URL.");
    const match = url.pathname.match(STRAVA_PROFILE_EMBED_PATH);
    if (!match) return unavailableEmbed("Use a complete Strava-generated profile feed or weekly summary iframe.");
    const profileUrl = normalizeStravaProfileUrl(
      `https://${STRAVA_PROFILE_HOST}/athletes/${match[1]}`,
    );
    return {
      ok: true,
      embedUrl: `https://${STRAVA_PROFILE_HOST}${url.pathname.replace(/\/$/, "")}`,
      kind: match[2] === "latest-rides" ? "profile_feed" : "profile_summary",
      inferredProfileUrl: profileUrl,
    };
  }

  if (url.hostname.toLowerCase() !== STRAVA_EMBED_HOST) {
    return unavailableEmbed("Use an embed generated by Strava, not a third-party URL.");
  }
  const canonical = canonicalizeCurrentEmbed(url);
  if (!canonical) {
    return unavailableEmbed("Use Strava’s current numeric activity or route embed without private-share parameters.");
  }
  const kind = new URL(canonical).pathname.startsWith("/route/")
    ? "route"
    : "activity";
  return { ok: true, embedUrl: canonical, kind, inferredProfileUrl: null };
}

export function isStravaPortableConfig(
  value: unknown,
): value is StravaPortableConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !["profileUrl", "embedUrl", "embedKind"].includes(key),
    ) ||
    !Object.hasOwn(record, "profileUrl") ||
    !Object.hasOwn(record, "embedUrl") ||
    !Object.hasOwn(record, "embedKind")
  ) {
    return false;
  }
  const profileUrl = normalizeStravaProfileUrl(record.profileUrl);
  if (!profileUrl || profileUrl !== record.profileUrl) return false;
  if (record.embedUrl === null || record.embedKind === null) {
    return record.embedUrl === null && record.embedKind === null;
  }
  const embed = normalizeStravaEmbed(record.embedUrl);
  return (
    embed.ok &&
    embed.embedUrl === record.embedUrl &&
    embed.kind === record.embedKind &&
    (!embed.inferredProfileUrl || embed.inferredProfileUrl === profileUrl)
  );
}

function frameAncestorsBlockEmbedding(value: string | null): boolean {
  if (!value) return false;
  const match = /(?:^|;)\s*frame-ancestors\s+([^;]+)/i.exec(value);
  if (!match) return false;
  const sources = match[1].trim().toLowerCase().split(/\s+/);
  if (sources.includes("'none'")) return true;

  // This health check cannot assume that the public portfolio is a Strava
  // origin. Only an origin-agnostic wildcard or HTTPS scheme source clearly
  // permits the production site. In particular, `self` combined with a
  // Strava-host wildcard still excludes the portfolio and must not be treated
  // as frameable.
  return !sources.some(
    (source) => source === "*" || source === "https:" || source === "https://*",
  );
}

export async function verifyStravaEmbed(
  embedUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<StravaHealthResult> {
  const checkedAt = new Date().toISOString();
  let response: Response;
  try {
    response = await fetcher(embedUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Anish-Shah-personal-site/1.0",
      },
    });
  } catch {
    return { status: "unavailable", checkedAt, reason: "provider_error" };
  }
  void response.body?.cancel();
  if (response.status >= 300 && response.status < 400) {
    return { status: "unavailable", checkedAt, reason: "redirected" };
  }
  if (!response.ok) {
    return { status: "unavailable", checkedAt, reason: "provider_error" };
  }
  const xFrameOptions = response.headers.get("x-frame-options")?.toLowerCase();
  if (
    xFrameOptions === "deny" ||
    xFrameOptions === "sameorigin" ||
    frameAncestorsBlockEmbedding(response.headers.get("content-security-policy"))
  ) {
    return { status: "unavailable", checkedAt, reason: "not_frameable" };
  }
  return { status: "available", checkedAt };
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
    typeof record.checkedAt !== "string"
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
  };
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

function healthCheckIsStale(stored: StoredStravaConfig): boolean {
  if (!stored.embedUrl || !stored.embedKind || !stored.checkedAt) return false;
  const checkedAt = Date.parse(stored.checkedAt);
  return (
    Number.isFinite(checkedAt) &&
    Date.now() - checkedAt >= HEALTH_CHECK_WINDOW_MS
  );
}

async function refreshStaleEmbedHealth(
  stored: StoredStravaConfig,
  database?: D1Database | null,
): Promise<StoredStravaConfig> {
  if (!healthCheckIsStale(stored) || !stored.embedUrl) return stored;

  const health = await verifyStravaEmbed(stored.embedUrl);
  const refreshed: StoredStravaConfig = {
    ...stored,
    embedStatus: health.status,
    checkedAt: health.checkedAt,
  };
  const binding = databaseOrNull(database);
  if (!binding) return refreshed;

  try {
    const update = await binding
      .prepare(
        `UPDATE editorial_settings
         SET value_json = ?, updated_at = ?
         WHERE key = ? AND value_json = ?`,
      )
      .bind(
        JSON.stringify(refreshed),
        health.checkedAt,
        STRAVA_SETTING_KEY,
        JSON.stringify(stored),
      )
      .run();
    if ((update.meta.changes ?? 0) !== 1) {
      const current = await readStoredConfig(database);
      if (current && current !== "database_unavailable") return current;
    }
  } catch {
    // A transient persistence failure must not make a known-bad widget public
    // for the current request. The next request can retry the health check.
  }
  return refreshed;
}

export async function getStravaPublicConfig(
  database?: D1Database | null,
): Promise<StravaConfigResult> {
  const storedResult = await readStoredConfig(database);
  if (storedResult === "database_unavailable") {
    return { status: "unavailable", reason: "database_unavailable" };
  }
  if (storedResult === null) {
    return { status: "unavailable", reason: "not_configured" };
  }
  const stored = await refreshStaleEmbedHealth(storedResult, database);
  const embed =
    stored.embedStatus === "available" &&
    stored.embedUrl &&
    stored.embedKind &&
    stored.checkedAt
      ? {
          kind: stored.embedKind,
          embedUrl: stored.embedUrl,
          checkedAt: stored.checkedAt,
        }
      : null;
  return {
    status: "ready",
    config: {
      provider: "strava",
      profileUrl: stored.profileUrl,
      embed,
      embedStatus: embed ? "available" : "unavailable",
      updatedAt: stored.updatedAt,
    },
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
        ? { status: "available" as const, checkedAt: previous.checkedAt as string }
        : {
            status: "unavailable" as const,
            checkedAt: previous?.checkedAt as string,
            reason: "provider_error" as const,
          }
      : await verifyStravaEmbed(normalizedEmbed.embedUrl)
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
      },
    },
  };
}

async function writePreparedStravaConfig(
  prepared: PreparedStravaConfig,
  actorEmail: string,
  database?: D1Database | null,
) {
  const binding = databaseOrNull(database);
  if (!binding) throw new Error("D1 database binding is unavailable.");
  const { stored } = prepared;
  await binding.batch([
    binding
      .prepare(
        `INSERT INTO editorial_settings (key, value_json, updated_by_email, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
           updated_by_email = excluded.updated_by_email, updated_at = excluded.updated_at`,
      )
      .bind(STRAVA_SETTING_KEY, JSON.stringify(stored), actorEmail, stored.updatedAt),
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
    updatedAt: stored.updatedAt,
  };
}

export async function saveStravaPublicConfig(
  input: unknown,
  actorEmail: string,
  database?: D1Database | null,
) {
  const current = await readStoredConfig(database);
  const prepared = await prepareStravaConfig(
    input,
    current && current !== "database_unavailable" ? current : null,
  );
  if (!prepared.ok) return prepared;
  return writePreparedStravaConfig(prepared.value, actorEmail, database);
}

export async function applyStravaPortableConfig(
  input: StravaPortableConfig,
  actorEmail: string,
  database?: D1Database | null,
): Promise<
  | Awaited<ReturnType<typeof writePreparedStravaConfig>>
  | { status: "failed"; ok: false; code: string; message: string }
> {
  const prepared = await prepareStravaConfig({
    profileUrl: input.profileUrl,
    embed: input.embedUrl,
  }, null, true);
  if (!prepared.ok) return { status: "failed", ...prepared };
  if (prepared.value.health?.status === "unavailable") {
    return {
      status: "failed",
      ok: false,
      code: "embed_unavailable",
      message: "The promoted Strava widget is not anonymously frameable. The current production configuration was left unchanged.",
    };
  }
  return writePreparedStravaConfig(prepared.value, actorEmail, database);
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
