import { runtimeDatabase } from "./runtime-env";

const STRAVA_SETTING_KEY = "connector.strava.public_embed";
const STRAVA_EMBED_HOST = "strava-embeds.com";
const STRAVA_LEGACY_PROFILE_HOST = "www.strava.com";
const STRAVA_LEGACY_PROFILE_PATH =
  /^\/athletes\/[1-9]\d{0,19}\/(?:latest-rides|activity-summary)\/[a-f0-9]{40}\/?$/i;
const STRAVA_CURRENT_EMBED_PATH =
  /^\/(activity|route)\/([1-9]\d{0,24})\/?$/;
const STRAVA_MODERN_SCRIPT_URL = "https://strava-embeds.com/embed.js";
const MAX_INPUT_LENGTH = 8192;
const MAX_URL_LENGTH = 2048;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const UNSAFE_MARKUP_CONTROL =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type StravaPublicConfig = {
  provider: "strava";
  embedUrl: string;
  coverage: "Official public Strava activity, loaded only after consent.";
  updatedAt: string;
};

export type StravaConfigResult =
  | { status: "ready"; config: StravaPublicConfig }
  | {
      status: "unavailable";
      reason:
        | "database_unavailable"
        | "not_configured"
        | "legacy_embed"
        | "invalid_config";
    };

export type StravaEmbedValidation =
  | { ok: true; embedUrl: string }
  | { ok: false; code: "invalid_embed"; message: string };

type EditorialSettingRow = {
  valueJson: string;
};

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

function canonicalEmbedUrl(
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
    [...script.keys()].some((key) => !scriptKeys.has(key))
  ) {
    return null;
  }

  if (
    placeholder.get("class") !== "strava-embed-placeholder" ||
    script.get("src") !== STRAVA_MODERN_SCRIPT_URL ||
    (script.has("type") &&
      script.get("type") !== "text/javascript" &&
      script.get("type") !== "module") ||
    (script.has("async") && script.get("async") !== null) ||
    (script.has("defer") && script.get("defer") !== null)
  ) {
    return null;
  }

  const type = placeholder.get("data-embed-type");
  const id = placeholder.get("data-embed-id");
  const style = placeholder.get("data-style");
  const fromEmbed = placeholder.get("data-from-embed");
  const fullWidth = placeholder.get("data-full-width");
  const booleanOptions = [
    placeholder.get("data-elevation-profile"),
    placeholder.get("data-slippy"),
    placeholder.get("data-surface-type"),
  ].filter((value): value is string | null => value !== undefined);
  const distance = placeholder.get("data-distance");
  const elevationGain = placeholder.get("data-elevation-gain");
  const mapHash = placeholder.get("data-map-hash");
  const units = placeholder.get("data-units");
  if (
    (type !== "activity" && type !== "route") ||
    !id ||
    !/^[1-9]\d{0,24}$/.test(id) ||
    (style !== undefined && style !== "standard") ||
    (fromEmbed !== undefined &&
      fromEmbed !== "true" &&
      fromEmbed !== "false") ||
    (fullWidth !== undefined &&
      fullWidth !== "true" &&
      fullWidth !== "false") ||
    (type !== "route" && fullWidth !== undefined) ||
    booleanOptions.some((value) => value !== "true" && value !== "false") ||
    (distance !== undefined &&
      (distance === null ||
        !/^\d{1,12}(?:\.\d{1,3})?$/.test(distance))) ||
    (elevationGain !== undefined &&
      (elevationGain === null ||
        !/^\d{1,12}(?:\.\d{1,3})?$/.test(elevationGain))) ||
    (mapHash !== undefined &&
      (mapHash === null ||
        !/^\d{1,2}(?:\.\d+)?\/-?\d{1,3}(?:\.\d+)?\/-?\d{1,3}(?:\.\d+)?$/.test(
          mapHash,
        ))) ||
    (units !== undefined && units !== "metric" && units !== "imperial") ||
    (type !== "route" &&
      (distance !== undefined ||
        elevationGain !== undefined ||
        mapHash !== undefined ||
        units !== undefined ||
        booleanOptions.length > 0))
  ) {
    return null;
  }

  return canonicalEmbedUrl(type, id, fullWidth === "true");
}

function iframeSource(value: string): string | null {
  if (!value.startsWith("<")) return value;

  const iframe = value.match(
    /^<iframe\b([^>]*)\/?>\s*(?:<\/iframe>)?$/i,
  );
  if (!iframe) return null;

  const matches = [
    ...iframe[1].matchAll(
      /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
    ),
  ];
  if (matches.length !== 1) return null;

  return matches[0][1] ?? matches[0][2] ?? matches[0][3] ?? null;
}

function isLegacyProfileEmbed(value: string): boolean {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"));
    const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1]?.toLowerCase();
    return (
      authority === STRAVA_LEGACY_PROFILE_HOST &&
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === STRAVA_LEGACY_PROFILE_HOST &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      STRAVA_LEGACY_PROFILE_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function canonicalizeCurrentEmbed(url: URL): string | null {
  const match = url.pathname.match(STRAVA_CURRENT_EMBED_PATH);
  if (!match) return null;

  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === "style" && value === "standard") continue;
    if (key === "fromEmbed" && (value === "true" || value === "false")) {
      continue;
    }
    if (
      key === "fullWidth" &&
      match[1] === "route" &&
      (value === "true" || value === "false")
    ) {
      continue;
    }
    return null;
  }

  return canonicalEmbedUrl(
    match[1] as "activity" | "route",
    match[2],
    url.searchParams.get("fullWidth") === "true",
  );
}

export function normalizeStravaEmbed(
  input: unknown,
): StravaEmbedValidation {
  if (typeof input !== "string") {
    return unavailableEmbed(
      "Paste an official Strava embed URL or iframe snippet.",
    );
  }
  if (
    !input.trim() ||
    input.length > MAX_INPUT_LENGTH ||
    UNSAFE_MARKUP_CONTROL.test(input)
  ) {
    return unavailableEmbed(
      "Paste one official Strava embed without unsafe control characters.",
    );
  }

  const trimmed = input.trim();
  const modernSource = modernPlaceholderSource(trimmed);
  if (modernSource) return { ok: true, embedUrl: modernSource };

  const source = iframeSource(trimmed);
  if (
    !source ||
    source.length > MAX_URL_LENGTH ||
    CONTROL_CHARACTER.test(source)
  ) {
    return unavailableEmbed(
      "The iframe must contain one official Strava embed URL.",
    );
  }

  if (isLegacyProfileEmbed(source)) {
    return unavailableEmbed(
      "Strava is redirecting this older profile-feed widget to sign-in. Replace it with a current public activity or route embed from Strava’s Share menu.",
    );
  }

  let url: URL;
  const authority = source.match(/^https:\/\/([^/?#]+)/i)?.[1];
  const normalizedAuthority = authority?.toLowerCase();
  if (normalizedAuthority !== STRAVA_EMBED_HOST) {
    return unavailableEmbed(
      "Use a current public Strava activity or route embed whose URL begins https://strava-embeds.com/.",
    );
  }
  try {
    url = new URL(source.replaceAll("&amp;", "&"));
  } catch {
    return unavailableEmbed("The Strava embed URL is malformed.");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== STRAVA_EMBED_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(url.toString())
  ) {
    return unavailableEmbed(
      "Use a current public Strava activity or route embed without credentials, control characters, a port, or a fragment.",
    );
  }

  const canonical = canonicalizeCurrentEmbed(url);
  if (!canonical) {
    return unavailableEmbed(
      "Use Strava’s current numeric activity or route embed. Private-share tokens and unrelated Strava pages are not published.",
    );
  }

  return { ok: true, embedUrl: canonical };
}

function databaseOrNull(
  database: D1Database | null | undefined,
): D1Database | null {
  return database === undefined ? runtimeDatabase() : database;
}

export async function getStravaPublicConfig(
  database?: D1Database | null,
): Promise<StravaConfigResult> {
  const binding = databaseOrNull(database);
  if (!binding) {
    return { status: "unavailable", reason: "database_unavailable" };
  }

  let row: EditorialSettingRow | null;
  try {
    row = await binding
      .prepare(
        `SELECT value_json AS valueJson
         FROM editorial_settings
         WHERE key = ?
         LIMIT 1`,
      )
      .bind(STRAVA_SETTING_KEY)
      .first<EditorialSettingRow>();
  } catch {
    return { status: "unavailable", reason: "database_unavailable" };
  }
  if (!row) return { status: "unavailable", reason: "not_configured" };

  let stored: unknown;
  try {
    stored = JSON.parse(row.valueJson);
  } catch {
    return { status: "unavailable", reason: "invalid_config" };
  }
  if (
    typeof stored !== "object" ||
    stored === null ||
    !("embedUrl" in stored) ||
    !("updatedAt" in stored) ||
    typeof stored.embedUrl !== "string" ||
    typeof stored.updatedAt !== "string" ||
    !isCanonicalIsoDateTime(stored.updatedAt)
  ) {
    return { status: "unavailable", reason: "invalid_config" };
  }

  if (isLegacyProfileEmbed(stored.embedUrl)) {
    return { status: "unavailable", reason: "legacy_embed" };
  }

  const normalized = normalizeStravaEmbed(stored.embedUrl);
  if (!normalized.ok || normalized.embedUrl !== stored.embedUrl) {
    return { status: "unavailable", reason: "invalid_config" };
  }

  return {
    status: "ready",
    config: {
      provider: "strava",
      embedUrl: normalized.embedUrl,
      coverage: "Official public Strava activity, loaded only after consent.",
      updatedAt: stored.updatedAt,
    },
  };
}

export async function saveStravaPublicConfig(
  input: unknown,
  actorEmail: string,
  database?: D1Database | null,
): Promise<
  | {
      status: "saved";
      provider: "strava";
      embedUrl: string;
      updatedAt: string;
    }
  | { ok: false; code: "invalid_embed"; message: string }
> {
  const normalized = normalizeStravaEmbed(input);
  if (!normalized.ok) return normalized;

  const binding = databaseOrNull(database);
  if (!binding) throw new Error("D1 database binding is unavailable.");

  const updatedAt = new Date().toISOString();
  const stored = JSON.stringify({
    embedUrl: normalized.embedUrl,
    updatedAt,
  });

  await binding.batch([
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
      .bind(STRAVA_SETTING_KEY, stored, actorEmail, updatedAt),
    binding
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, 'connector.config_saved', 'connector', 'strava', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        JSON.stringify({ configuration: "official_embed" }),
        updatedAt,
      ),
  ]);

  return {
    status: "saved",
    provider: "strava",
    embedUrl: normalized.embedUrl,
    updatedAt,
  };
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
    binding
      .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
      .bind(STRAVA_SETTING_KEY),
    binding
      .prepare(`DELETE FROM connector_credentials WHERE provider = 'strava'`),
    binding
      .prepare(`DELETE FROM connector_snapshots WHERE provider = 'strava'`),
    binding.prepare(`DELETE FROM sync_runs WHERE provider = 'strava'`),
    binding
      .prepare(
        `DELETE FROM audit_log
         WHERE entity_type = 'connector' AND entity_id = 'strava'`,
      ),
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
