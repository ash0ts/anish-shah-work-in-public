import { runtimeDatabase } from "../runtime-env";
import { parseStoredConnectorPublicPayload } from "./public-payload-policy";
import { connectorPublicationGate } from "./publication-approval";

export const SPOTIFY_PRESENTATION_SETTING_KEY =
  "connector.spotify.presentation";

export type SpotifyFallbackEmbed = {
  kind: "track" | "album" | "playlist";
  spotifyId: string;
};

export type SpotifyPresentationConfig = {
  publishTopTracks: boolean;
  reviewedAt: string | null;
  fallbackEmbed: SpotifyFallbackEmbed | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
};

export type SpotifyPublicFallback = {
  profileUrl: string | null;
  fallbackEmbed: SpotifyFallbackEmbed | null;
};

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const CONFIG_VERSION = 1;
const MAX_FALLBACK_INPUT_LENGTH = 4_096;

type StoredPresentation = {
  schemaVersion?: unknown;
  publishTopTracks?: unknown;
  reviewedAt?: unknown;
  fallbackEmbed?: unknown;
};

function emptyConfig(): SpotifyPresentationConfig {
  return {
    publishTopTracks: false,
    reviewedAt: null,
    fallbackEmbed: null,
    updatedAt: null,
    updatedByEmail: null,
  };
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function parseFallbackEmbed(value: unknown): SpotifyFallbackEmbed | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return (record.kind === "track" ||
    record.kind === "album" ||
    record.kind === "playlist") &&
    typeof record.spotifyId === "string" &&
    SPOTIFY_ID.test(record.spotifyId)
    ? { kind: record.kind, spotifyId: record.spotifyId }
    : null;
}

function parseStoredConfig(
  valueJson: string,
  updatedAt: string | null,
  updatedByEmail: string | null,
): SpotifyPresentationConfig | null {
  let value: StoredPresentation;
  try {
    value = JSON.parse(valueJson) as StoredPresentation;
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    value.schemaVersion !== CONFIG_VERSION ||
    typeof value.publishTopTracks !== "boolean"
  ) {
    return null;
  }
  const fallbackEmbed =
    value.fallbackEmbed === null || value.fallbackEmbed === undefined
      ? null
      : parseFallbackEmbed(value.fallbackEmbed);
  if (value.fallbackEmbed && !fallbackEmbed) return null;
  if (
    value.reviewedAt !== null &&
    value.reviewedAt !== undefined &&
    !validIsoDate(value.reviewedAt)
  ) {
    return null;
  }
  return {
    publishTopTracks: value.publishTopTracks,
    reviewedAt: validIsoDate(value.reviewedAt) ? value.reviewedAt : null,
    fallbackEmbed,
    updatedAt,
    updatedByEmail,
  };
}

function extractFallbackUrl(value: string): string | null {
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > MAX_FALLBACK_INPUT_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }
  if (!candidate.startsWith("<")) return candidate;
  const match = /\bsrc\s*=\s*(["'])(https:\/\/open\.spotify\.com\/[^"']+)\1/i.exec(
    candidate,
  );
  return match?.[2] ?? null;
}

export function normalizeSpotifyFallbackEmbed(
  value: string,
): SpotifyFallbackEmbed | null {
  const extracted = extractFallbackUrl(value);
  if (!extracted) return null;
  let url: URL;
  try {
    url = new URL(extracted);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "open.spotify.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    return null;
  }
  const match = /^\/(?:embed\/)?(track|album|playlist)\/([A-Za-z0-9]{22})\/?$/.exec(
    url.pathname,
  );
  return match
    ? {
        kind: match[1] as SpotifyFallbackEmbed["kind"],
        spotifyId: match[2],
      }
    : null;
}

export async function getSpotifyPresentationConfig(): Promise<
  | { status: "ready"; config: SpotifyPresentationConfig }
  | { status: "setup_required" }
> {
  const database = runtimeDatabase();
  if (!database) return { status: "setup_required" };
  try {
    const row = await database
      .prepare(
        `SELECT value_json AS valueJson, updated_at AS updatedAt,
                updated_by_email AS updatedByEmail
         FROM editorial_settings
         WHERE key = ?
         LIMIT 1`,
      )
      .bind(SPOTIFY_PRESENTATION_SETTING_KEY)
      .first<{
        valueJson: string;
        updatedAt: string;
        updatedByEmail: string | null;
      }>();
    if (!row) return { status: "ready", config: emptyConfig() };
    const config = parseStoredConfig(
      row.valueJson,
      row.updatedAt,
      row.updatedByEmail,
    );
    return config
      ? { status: "ready", config }
      : { status: "setup_required" };
  } catch {
    return { status: "setup_required" };
  }
}

export async function saveSpotifyPresentationConfig(input: {
  publishTopTracks: boolean;
  fallbackEmbed?: string | null;
  acknowledgePublicDisplay?: boolean;
  actorEmail: string;
}): Promise<
  | { status: "saved"; config: SpotifyPresentationConfig }
  | { status: "invalid"; reason: "acknowledgement" | "fallback_embed" }
  | { status: "setup_required" }
> {
  if (input.publishTopTracks && input.acknowledgePublicDisplay !== true) {
    return { status: "invalid", reason: "acknowledgement" };
  }
  const current = await getSpotifyPresentationConfig();
  if (current.status !== "ready") return current;
  const fallbackEmbed =
    input.fallbackEmbed === undefined
      ? current.config.fallbackEmbed
      : input.fallbackEmbed === null || input.fallbackEmbed.trim() === ""
        ? null
        : normalizeSpotifyFallbackEmbed(input.fallbackEmbed);
  if (
    input.fallbackEmbed !== undefined &&
    input.fallbackEmbed !== null &&
    input.fallbackEmbed.trim() !== "" &&
    !fallbackEmbed
  ) {
    return { status: "invalid", reason: "fallback_embed" };
  }

  const database = runtimeDatabase();
  if (!database) return { status: "setup_required" };
  const now = new Date().toISOString();
  const stored = {
    schemaVersion: CONFIG_VERSION,
    publishTopTracks: input.publishTopTracks,
    reviewedAt: input.publishTopTracks ? now : null,
    fallbackEmbed,
  };
  try {
    await database.batch([
      database
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
          SPOTIFY_PRESENTATION_SETTING_KEY,
          JSON.stringify(stored),
          input.actorEmail,
          now,
        ),
      database
        .prepare(
          `INSERT INTO audit_log (
             id, actor_email, action, entity_type, entity_id,
             details_json, created_at
           ) VALUES (?, ?, 'connector.presentation_saved', 'connector',
                     'spotify', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.actorEmail,
          JSON.stringify({
            publishTopTracks: input.publishTopTracks,
            fallbackKind: fallbackEmbed?.kind ?? null,
          }),
          now,
        ),
    ]);
  } catch {
    return { status: "setup_required" };
  }
  return {
    status: "saved",
    config: {
      publishTopTracks: input.publishTopTracks,
      reviewedAt: stored.reviewedAt,
      fallbackEmbed,
      updatedAt: now,
      updatedByEmail: input.actorEmail,
    },
  };
}

export async function deleteSpotifyPresentationConfig(
  database: D1Database,
): Promise<void> {
  await database
    .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
    .bind(SPOTIFY_PRESENTATION_SETTING_KEY)
    .run();
}

export async function getSpotifyPublicFallback(): Promise<SpotifyPublicFallback> {
  const presentation = await getSpotifyPresentationConfig();
  const fallbackEmbed =
    presentation.status === "ready"
      ? presentation.config.fallbackEmbed
      : null;
  const database = runtimeDatabase();
  if (!database) return { profileUrl: null, fallbackEmbed };

  const publicationGate = await connectorPublicationGate("spotify", database);
  if (publicationGate.status !== "allowed") {
    return { profileUrl: null, fallbackEmbed: null };
  }

  let profileUrl: string | null = null;
  try {
    const rows = await database
      .prepare(
        `SELECT public_payload_json AS publicPayloadJson
         FROM connector_snapshots
         WHERE provider = 'spotify' AND status = 'ready'
         ORDER BY fetched_at DESC
         LIMIT 2`,
      )
      .all<{ publicPayloadJson: string }>();
    for (const row of rows.results ?? []) {
      const payload = parseStoredConnectorPublicPayload(
        "spotify",
        row.publicPayloadJson,
      );
      if (payload && typeof payload.profileUrl === "string") {
        profileUrl = payload.profileUrl;
        break;
      }
    }
  } catch {
    // A configured embed remains usable even if the snapshot store is offline.
  }
  return { profileUrl, fallbackEmbed };
}
