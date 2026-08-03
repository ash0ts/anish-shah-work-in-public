import { validatePublicProjection } from "../editorial-policy";
import { isStoredArtworkRef } from "./artwork";
import type { ConnectorProvider } from "./types";

const PROFILE_POLICIES: Record<
  ConnectorProvider,
  { hosts: ReadonlySet<string>; path: RegExp }
> = {
  myanimelist: {
    hosts: new Set(["myanimelist.net", "www.myanimelist.net"]),
    path: /^\/profile\/[a-z0-9_-]{1,64}\/?$/i,
  },
  hardcover: {
    hosts: new Set(["hardcover.app", "www.hardcover.app"]),
    path: /^\/@[a-z0-9_-]{1,64}\/?$/i,
  },
  spotify: {
    hosts: new Set(["open.spotify.com"]),
    path: /^\/user\/[a-z0-9._~-]{1,128}\/?$/i,
  },
  steam: {
    hosts: new Set(["steamcommunity.com", "www.steamcommunity.com"]),
    path: /^\/profiles\/\d{17}\/?$/,
  },
};

const FORBIDDEN_CREDENTIAL_FIELDS = new Set([
  "apikey",
  "authorization",
  "ciphertext",
  "credential",
  "iv",
  "key",
  "password",
  "refreshtoken",
  "secret",
  "steamid",
  "steamid64",
  "token",
  "accesstoken",
]);

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_TIME_RANGES = [
  "short_term",
  "medium_term",
  "long_term",
] as const;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function boundedPublicString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validSpotifyTrack(value: unknown, expectedPosition: number): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const track = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(
      track,
      ["id", "position", "title", "artists", "album", "durationMs", "explicit"],
    ) ||
    typeof track.id !== "string" ||
    !SPOTIFY_ID.test(track.id) ||
    track.position !== expectedPosition ||
    !boundedPublicString(track.title, 512) ||
    !Array.isArray(track.artists) ||
    track.artists.length < 1 ||
    track.artists.length > 32 ||
    typeof track.durationMs !== "number" ||
    !Number.isSafeInteger(track.durationMs) ||
    track.durationMs < 1 ||
    track.durationMs > 24 * 60 * 60 * 1000 ||
    typeof track.explicit !== "boolean"
  ) {
    return false;
  }
  if (
    !track.artists.every((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      const artist = value as Record<string, unknown>;
      return (
        hasOnlyKeys(artist, ["id", "name"]) &&
        typeof artist.id === "string" &&
        SPOTIFY_ID.test(artist.id) &&
        boundedPublicString(artist.name, 512)
      );
    })
  ) {
    return false;
  }
  if (
    typeof track.album !== "object" ||
    track.album === null ||
    Array.isArray(track.album)
  ) {
    return false;
  }
  const album = track.album as Record<string, unknown>;
  return (
    hasOnlyKeys(album, ["id", "title", "releaseYear"], ["artwork"]) &&
    typeof album.id === "string" &&
    SPOTIFY_ID.test(album.id) &&
    boundedPublicString(album.title, 512) &&
    (album.releaseYear === null ||
      (typeof album.releaseYear === "number" &&
        Number.isSafeInteger(album.releaseYear) &&
        album.releaseYear >= 1000 &&
        album.releaseYear <= 9999)) &&
    (!Object.hasOwn(album, "artwork") ||
      (isStoredArtworkRef(album.artwork) &&
        album.artwork.kind === "spotify-cover"))
  );
}

function validSpotifyPayload(payload: Record<string, unknown>): boolean {
  if (
    !hasOnlyKeys(payload, [
      "provider",
      "snapshotVersion",
      "profileUrl",
      "coverage",
      "windows",
      "syncedAt",
      "freshUntil",
    ]) ||
    payload.provider !== "spotify" ||
    payload.snapshotVersion !== 1 ||
    payload.coverage !== "Spotify-calculated affinity; not play counts" ||
    !validIsoTimestamp(payload.syncedAt) ||
    !validIsoTimestamp(payload.freshUntil) ||
    typeof payload.windows !== "object" ||
    payload.windows === null ||
    Array.isArray(payload.windows)
  ) {
    return false;
  }
  const windows = payload.windows as Record<string, unknown>;
  if (!hasOnlyKeys(windows, SPOTIFY_TIME_RANGES)) return false;
  return SPOTIFY_TIME_RANGES.every((range) => {
    const value = windows[range];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const window = value as Record<string, unknown>;
    if (!hasOnlyKeys(window, ["tracks"]) || !Array.isArray(window.tracks)) {
      return false;
    }
    if (window.tracks.length > 12) return false;
    const seen = new Set<string>();
    return window.tracks.every((track, index) => {
      if (!validSpotifyTrack(track, index + 1)) return false;
      const id = (track as Record<string, unknown>).id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });
}

export function normalizeConnectorProfileUrl(
  provider: ConnectorProvider,
  value: string | undefined,
): string | null {
  const candidate = value?.trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const policy = PROFILE_POLICIES[provider];
  if (
    url.protocol !== "https:" ||
    !policy.hosts.has(url.hostname.toLocaleLowerCase()) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !policy.path.test(url.pathname)
  ) {
    return null;
  }

  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function hasForbiddenCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenCredentialField);
  }
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      FORBIDDEN_CREDENTIAL_FIELDS.has(
        key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase(),
      ) || hasForbiddenCredentialField(child),
  );
}

function hasUnexpectedUrlField(
  value: unknown,
  provider: ConnectorProvider,
  path = "payload",
): boolean {
  if (Array.isArray(value)) {
    return value.some((child, index) =>
      hasUnexpectedUrlField(child, provider, `${path}[${index}]`),
    );
  }
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => {
      const childPath = `${path}.${key}`;
      if (/url$|uri$|image$/i.test(key)) {
        return !(
          path === "payload" &&
          key === "profileUrl" &&
          (child === null ||
            (typeof child === "string" &&
              normalizeConnectorProfileUrl(provider, child) === child))
        );
      }
      return hasUnexpectedUrlField(child, provider, childPath);
    },
  );
}

function hasUnexpectedUrlText(
  value: unknown,
  provider: ConnectorProvider,
  path = "payload",
): boolean {
  if (typeof value === "string") {
    if (!/(?:https?|file):\/\//i.test(value)) return false;
    return !(
      path === "payload.profileUrl" &&
      normalizeConnectorProfileUrl(provider, value) === value
    );
  }
  if (Array.isArray(value)) {
    return value.some((child, index) =>
      hasUnexpectedUrlText(child, provider, `${path}[${index}]`),
    );
  }
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    hasUnexpectedUrlText(child, provider, `${path}.${key}`),
  );
}

export function validateConnectorPublicPayload(
  provider: ConnectorProvider,
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    payload.provider === provider &&
    (provider !== "spotify" || validSpotifyPayload(payload)) &&
    Object.hasOwn(payload, "profileUrl") &&
    (payload.profileUrl === null ||
      (typeof payload.profileUrl === "string" &&
        normalizeConnectorProfileUrl(provider, payload.profileUrl) ===
          payload.profileUrl)) &&
    !hasForbiddenCredentialField(payload) &&
    !hasUnexpectedUrlField(payload, provider) &&
    !hasUnexpectedUrlText(payload, provider) &&
    validatePublicProjection(payload, `connector:${provider}`).ok
  );
}

export function parseStoredConnectorPublicPayload(
  provider: ConnectorProvider,
  value: string,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return validateConnectorPublicPayload(provider, parsed) ? parsed : null;
  } catch {
    return null;
  }
}
