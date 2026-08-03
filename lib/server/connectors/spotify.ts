import {
  ConnectorFetchError,
  type ConnectorFetchResult,
  type SpotifyOAuthCredential,
} from "./types";
import { normalizeConnectorProfileUrl } from "./public-payload-policy";
import {
  normalizeSpotifyArtwork,
  type StoredArtworkRef,
} from "./artwork";

export const SPOTIFY_TIME_RANGES = [
  "short_term",
  "medium_term",
  "long_term",
] as const;
export type SpotifyTimeRange = (typeof SPOTIFY_TIME_RANGES)[number];

type SpotifyTrack = {
  id: string;
  position: number;
  title: string;
  artists: Array<{ id: string; name: string }>;
  album: {
    id: string;
    title: string;
    releaseYear: number | null;
    artwork?: StoredArtworkRef;
  };
  durationMs: number;
  explicit: boolean;
};

const API_ORIGIN = "https://api.spotify.com";
const TRACK_LIMIT = 12;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;
const MAX_TITLE_LENGTH = 512;
const MAX_ARTISTS = 32;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_USER_ID = /^[A-Za-z0-9._~-]{1,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function schemaError(message: string): never {
  throw new ConnectorFetchError(message, {
    code: "provider_schema_changed",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  maximumLength: number,
  field: string,
): string {
  if (typeof value !== "string") {
    return schemaError(`Spotify returned an unexpected ${field}.`);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    return schemaError(`Spotify returned an unexpected ${field}.`);
  }
  return normalized;
}

function requiredId(value: unknown, field: string): string {
  const id = requiredString(value, 64, field);
  return SPOTIFY_ID.test(id)
    ? id
    : schemaError(`Spotify returned an unexpected ${field}.`);
}

function requiredInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return schemaError(`Spotify returned an unexpected ${field}.`);
  }
  return value;
}

function releaseYear(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const date = requiredString(value, 10, "album release date");
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (!match) return schemaError("Spotify returned an unexpected release date.");
  const year = Number(match[1]);
  return year >= 1000 && year <= 9999
    ? year
    : schemaError("Spotify returned an unexpected release date.");
}

async function boundedJson(
  response: Response,
  context: string,
): Promise<unknown> {
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return schemaError(`Spotify returned an unexpected ${context} response.`);
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new ConnectorFetchError(
      `Spotify returned too much ${context} data.`,
      { code: "provider_payload_too_large" },
    );
  }

  if (!response.body) {
    return schemaError(`Spotify returned an unexpected ${context} response.`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ConnectorFetchError(
          `Spotify returned too much ${context} data.`,
          { code: "provider_payload_too_large" },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    return schemaError(`Spotify returned an unexpected ${context} response.`);
  }
}

async function boundedErrorJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_ERROR_RESPONSE_BYTES)
  ) {
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ERROR_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return null;
  }
}

async function spotifyError(response: Response): Promise<ConnectorFetchError> {
  let quotaExceeded = false;
  if (response.status === 429) {
    try {
      const value = await boundedErrorJson(response);
      quotaExceeded =
        isRecord(value) &&
        isRecord(value.error) &&
        value.error.reason === "QUOTA_EXCEEDED";
    } catch {
      // Provider response details are intentionally discarded.
    }
  }

  const code =
    response.status === 401
      ? "credential_expired"
      : response.status === 403
        ? "provider_forbidden"
        : response.status === 429
          ? quotaExceeded
            ? "quota_exceeded"
            : "rate_limited"
          : "provider_error";
  return new ConnectorFetchError(
    response.status === 401
      ? "Spotify authorization needs to be renewed."
      : response.status === 403
        ? "Spotify did not allow this application to read the owner account."
        : response.status === 429
          ? "Spotify is temporarily rate-limiting synchronization."
          : "Spotify could not be synchronized.",
    {
      code,
      httpStatus: response.status,
      retryable: response.status === 429 || response.status >= 500,
    },
  );
}

async function spotifyGet(
  path: string,
  accessToken: string,
  context: string,
): Promise<{ body: unknown; etag?: string }> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new ConnectorFetchError(
      "Spotify synchronization is temporarily unavailable.",
      { code: "provider_error", retryable: true },
    );
  }
  if (!response.ok) throw await spotifyError(response);
  return {
    body: await boundedJson(response, context),
    etag: response.headers.get("etag") ?? undefined,
  };
}

function normalizeArtwork(value: unknown): StoredArtworkRef | undefined {
  if (!Array.isArray(value) || value.length > 16) {
    if (value === undefined || value === null) return undefined;
    return schemaError("Spotify returned an unexpected artwork list.");
  }
  for (const image of value) {
    if (!isRecord(image)) {
      return schemaError("Spotify returned an unexpected artwork record.");
    }
    const artwork = normalizeSpotifyArtwork(image.url);
    if (artwork) return artwork;
  }
  return undefined;
}

function normalizeTrack(value: unknown, position: number): SpotifyTrack {
  if (!isRecord(value)) {
    return schemaError("Spotify returned an unexpected track record.");
  }
  if (!Array.isArray(value.artists) || value.artists.length < 1 || value.artists.length > MAX_ARTISTS) {
    return schemaError("Spotify returned an unexpected artist list.");
  }
  const artists = value.artists.map((artist) => {
    if (!isRecord(artist)) {
      return schemaError("Spotify returned an unexpected artist record.");
    }
    return {
      id: requiredId(artist.id, "artist ID"),
      name: requiredString(artist.name, MAX_TITLE_LENGTH, "artist name"),
    };
  });
  if (!isRecord(value.album)) {
    return schemaError("Spotify returned an unexpected album record.");
  }
  const artwork = normalizeArtwork(value.album.images);
  if (typeof value.explicit !== "boolean") {
    return schemaError("Spotify returned an unexpected explicit-content flag.");
  }
  return {
    id: requiredId(value.id, "track ID"),
    position,
    title: requiredString(value.name, MAX_TITLE_LENGTH, "track title"),
    artists,
    album: {
      id: requiredId(value.album.id, "album ID"),
      title: requiredString(
        value.album.name,
        MAX_TITLE_LENGTH,
        "album title",
      ),
      releaseYear: releaseYear(value.album.release_date),
      ...(artwork ? { artwork } : {}),
    },
    durationMs: requiredInteger(
      value.duration_ms,
      1,
      24 * 60 * 60 * 1000,
      "track duration",
    ),
    explicit: value.explicit,
  };
}

function normalizeTopTracks(value: unknown): SpotifyTrack[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return schemaError("Spotify returned an unexpected top-tracks response.");
  }
  if (value.items.length > TRACK_LIMIT) {
    return schemaError("Spotify returned too many top tracks.");
  }
  const seen = new Set<string>();
  return value.items.map((item, index) => {
    const track = normalizeTrack(item, index + 1);
    if (seen.has(track.id)) {
      return schemaError("Spotify returned a repeated top track.");
    }
    seen.add(track.id);
    return track;
  });
}

export async function fetchSpotifySnapshot(
  credential: SpotifyOAuthCredential,
): Promise<ConnectorFetchResult> {
  const accessToken = credential.accessToken.trim();
  if (
    !accessToken ||
    accessToken.length > 8192 ||
    CONTROL_CHARACTER.test(accessToken) ||
    /\s/.test(accessToken)
  ) {
    throw new ConnectorFetchError("Spotify access token is empty.", {
      code: "credential_invalid",
    });
  }

  const identityResponse = await spotifyGet(
    "/v1/me",
    accessToken,
    "identity",
  );
  if (!isRecord(identityResponse.body)) {
    return schemaError("Spotify returned an unexpected identity response.");
  }
  const profileId = requiredString(
    identityResponse.body.id,
    128,
    "profile ID",
  );
  if (!SPOTIFY_USER_ID.test(profileId)) {
    return schemaError("Spotify returned an unexpected profile ID.");
  }
  const profileUrl = normalizeConnectorProfileUrl(
    "spotify",
    `https://open.spotify.com/user/${encodeURIComponent(profileId)}`,
  );
  if (!profileUrl) {
    throw new ConnectorFetchError(
      "Spotify profile attribution could not be normalized.",
      { code: "public_payload_rejected" },
    );
  }

  const responses = await Promise.all(
    SPOTIFY_TIME_RANGES.map((range) =>
      spotifyGet(
        `/v1/me/top/tracks?time_range=${range}&limit=${TRACK_LIMIT}&offset=0`,
        accessToken,
        `${range} top-tracks`,
      ),
    ),
  );
  const windows = Object.fromEntries(
    SPOTIFY_TIME_RANGES.map((range, index) => [
      range,
      { tracks: normalizeTopTracks(responses[index].body) },
    ]),
  );
  const itemCount = Object.values(windows).reduce(
    (total, window) => total + window.tracks.length,
    0,
  );

  return {
    publicPayload: {
      provider: "spotify",
      snapshotVersion: 1,
      profileUrl,
      coverage: "Spotify-calculated affinity; not play counts",
      windows,
    },
    itemCount,
    etag:
      identityResponse.etag ??
      responses.find((response) => response.etag)?.etag,
  };
}
