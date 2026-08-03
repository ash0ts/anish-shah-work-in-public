import type { ConnectorProvider } from "./types";

export type StoredArtworkRef =
  | { kind: "mal-cover"; assetKey: string }
  | { kind: "hardcover-cover"; assetKey: string }
  | { kind: "spotify-cover"; assetKey: string }
  | { kind: "steam-icon"; appId: string; hash: string };

export type PublicArtwork = {
  src: `/api/connector-artwork/${ConnectorProvider}/${string}`;
  aspect: "poster" | "square";
};

export type ResolvedArtwork = {
  upstreamUrl: string;
  cacheIdentity: string;
  aspect: "poster" | "square";
  cacheMaxAgeSeconds?: number;
};

const MAL_ARTWORK_HOST = "cdn.myanimelist.net";
const HARDCOVER_ARTWORK_HOST = "assets.hardcover.app";
const STEAM_ARTWORK_HOST = "media.steampowered.com";
const SPOTIFY_ARTWORK_HOST = "i.scdn.co";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const MAL_PATH =
  /^\/images\/anime\/(?:[a-z0-9._~-]+\/){1,4}[a-z0-9._~-]+\.(?:jpe?g|png|webp)$/i;
const HARDCOVER_PATH =
  /^\/[a-z0-9._~!$&'()+,;=:@%/-]{1,1800}\.(?:jpe?g|png|webp)$/i;
const STEAM_ICON_HASH = /^[a-f0-9]{40}$/i;
const DECIMAL_ID = /^[1-9]\d{0,24}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_ARTWORK_PATH = /^\/image\/[A-Za-z0-9_-]{20,128}$/;

function exactHttpsUrl(value: unknown, host: string): URL | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2_048 ||
    CONTROL_CHARACTER.test(value)
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  return url.protocol === "https:" &&
    url.hostname.toLowerCase() === host &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash &&
    !/%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i.test(url.pathname)
    ? url
    : null;
}

export function normalizeMyAnimeListArtwork(
  value: unknown,
): StoredArtworkRef | null {
  const url = exactHttpsUrl(value, MAL_ARTWORK_HOST);
  if (!url || !MAL_PATH.test(url.pathname)) return null;
  return { kind: "mal-cover", assetKey: url.pathname };
}

export function normalizeHardcoverArtwork(
  value: unknown,
): StoredArtworkRef | null {
  const url = exactHttpsUrl(value, HARDCOVER_ARTWORK_HOST);
  if (!url || !HARDCOVER_PATH.test(url.pathname)) return null;
  return { kind: "hardcover-cover", assetKey: url.pathname };
}

export function normalizeSteamArtwork(
  appId: string,
  hash: unknown,
): StoredArtworkRef | null {
  if (
    !DECIMAL_ID.test(appId) ||
    typeof hash !== "string" ||
    !STEAM_ICON_HASH.test(hash)
  ) {
    return null;
  }
  return {
    kind: "steam-icon",
    appId,
    hash: hash.toLowerCase(),
  };
}

export function normalizeSpotifyArtwork(
  value: unknown,
): StoredArtworkRef | null {
  const url = exactHttpsUrl(value, SPOTIFY_ARTWORK_HOST);
  if (!url || !SPOTIFY_ARTWORK_PATH.test(url.pathname)) return null;
  return { kind: "spotify-cover", assetKey: url.pathname };
}

export function isStoredArtworkRef(value: unknown): value is StoredArtworkRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "mal-cover") {
    return (
      typeof candidate.assetKey === "string" &&
      MAL_PATH.test(candidate.assetKey)
    );
  }
  if (candidate.kind === "hardcover-cover") {
    return (
      typeof candidate.assetKey === "string" &&
      HARDCOVER_PATH.test(candidate.assetKey)
    );
  }
  if (candidate.kind === "spotify-cover") {
    return (
      typeof candidate.assetKey === "string" &&
      SPOTIFY_ARTWORK_PATH.test(candidate.assetKey)
    );
  }
  return (
    candidate.kind === "steam-icon" &&
    typeof candidate.appId === "string" &&
    DECIMAL_ID.test(candidate.appId) &&
    typeof candidate.hash === "string" &&
    STEAM_ICON_HASH.test(candidate.hash)
  );
}

export function publicArtworkForItem(
  provider: ConnectorProvider,
  itemId: string,
  value: unknown,
): PublicArtwork | null {
  const validItemId =
    provider === "spotify"
      ? SPOTIFY_ID.test(itemId)
      : DECIMAL_ID.test(itemId);
  if (!isStoredArtworkRef(value) || !validItemId) return null;
  const expectedKind =
    provider === "myanimelist"
      ? "mal-cover"
      : provider === "hardcover"
        ? "hardcover-cover"
        : provider === "spotify"
          ? "spotify-cover"
          : "steam-icon";
  if (value.kind !== expectedKind) return null;
  if (value.kind === "steam-icon" && value.appId !== itemId) return null;
  return {
    src: `/api/connector-artwork/${provider}/${itemId}`,
    aspect:
      provider === "steam" || provider === "spotify"
        ? "square"
        : "poster",
  };
}

export function resolveArtworkFromSnapshot(
  provider: ConnectorProvider,
  payload: Record<string, unknown>,
  itemId: string,
): ResolvedArtwork | null {
  const validItemId =
    provider === "spotify"
      ? SPOTIFY_ID.test(itemId)
      : DECIMAL_ID.test(itemId);
  if (!validItemId) return null;

  if (provider === "spotify") {
    if (typeof payload.windows !== "object" || payload.windows === null) {
      return null;
    }
    let matched: Record<string, unknown> | null = null;
    for (const window of Object.values(
      payload.windows as Record<string, unknown>,
    )) {
      if (typeof window !== "object" || window === null) continue;
      const tracks = (window as Record<string, unknown>).tracks;
      if (!Array.isArray(tracks)) continue;
      const candidate = tracks.find(
        (track) =>
          typeof track === "object" &&
          track !== null &&
          (track as Record<string, unknown>).id === itemId,
      );
      if (typeof candidate === "object" && candidate !== null) {
        matched = candidate as Record<string, unknown>;
        break;
      }
    }
    const album = matched?.album;
    if (typeof album !== "object" || album === null) return null;
    const artwork = (album as Record<string, unknown>).artwork;
    const projected = publicArtworkForItem(provider, itemId, artwork);
    if (
      !projected ||
      !isStoredArtworkRef(artwork) ||
      artwork.kind !== "spotify-cover"
    ) {
      return null;
    }
    return {
      upstreamUrl: `https://${SPOTIFY_ARTWORK_HOST}${artwork.assetKey}`,
      cacheIdentity: `${artwork.kind}:${artwork.assetKey}`,
      aspect: "square",
      cacheMaxAgeSeconds: 3_600,
    };
  }

  if (!Array.isArray(payload.library)) return null;

  const item = payload.library.find((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const record = candidate as Record<string, unknown>;
    const id = provider === "steam" ? record.appId : record.id;
    return id === itemId;
  });
  if (typeof item !== "object" || item === null) return null;

  const artwork = (item as Record<string, unknown>).artwork;
  const projected = publicArtworkForItem(provider, itemId, artwork);
  if (!projected || !isStoredArtworkRef(artwork)) return null;

  if (artwork.kind === "mal-cover") {
    return {
      upstreamUrl: `https://${MAL_ARTWORK_HOST}${artwork.assetKey}`,
      cacheIdentity: `${artwork.kind}:${artwork.assetKey}`,
      aspect: "poster",
    };
  }
  if (artwork.kind === "hardcover-cover") {
    return {
      upstreamUrl: `https://${HARDCOVER_ARTWORK_HOST}${artwork.assetKey}`,
      cacheIdentity: `${artwork.kind}:${artwork.assetKey}`,
      aspect: "poster",
    };
  }
  if (artwork.kind === "spotify-cover") return null;
  return {
    upstreamUrl: `https://${STEAM_ARTWORK_HOST}/steamcommunity/public/images/apps/${artwork.appId}/${artwork.hash}.jpg`,
    cacheIdentity: `${artwork.kind}:${artwork.appId}:${artwork.hash}`,
    aspect: "square",
  };
}
