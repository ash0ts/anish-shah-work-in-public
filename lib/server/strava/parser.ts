const STRAVA_EMBED_HOST = "strava-embeds.com";
const STRAVA_PROFILE_HOST = "www.strava.com";
const STRAVA_PROFILE_PATH = /^\/athletes\/([1-9]\d{0,19})\/?$/;
const STRAVA_PROFILE_EMBED_PATH =
  /^\/athletes\/([1-9]\d{0,19})\/(latest-rides|activity-summary)\/([a-f0-9]{40})\/?$/i;
const STRAVA_CURRENT_EMBED_PATH = /^\/(activity|route)\/([1-9]\d{0,24})\/?$/;
const STRAVA_MODERN_SCRIPT_URL = "https://strava-embeds.com/embed.js";
const MAX_INPUT_LENGTH = 8_192;
const MAX_URL_LENGTH = 2_048;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const UNSAFE_MARKUP_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

import type { StravaEmbedValidation, StravaPortableConfig } from "./types";

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
    if (/^\/activities\/\d+\/embed\//.test(url.pathname)) {
      return unavailableEmbed("This legacy activity embed is no longer supported. Copy a fresh embed from the activity’s Share menu.");
    }
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
