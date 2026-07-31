import type { ConnectorProvider } from "./types";

export type StoredArtworkRef =
  | { kind: "mal-cover"; assetKey: string }
  | { kind: "hardcover-cover"; assetKey: string }
  | { kind: "steam-icon"; appId: string; hash: string };

export type PublicArtwork = {
  src: `/api/connector-artwork/${ConnectorProvider}/${string}`;
  aspect: "poster" | "square";
};

export type ResolvedArtwork = {
  upstreamUrl: string;
  cacheIdentity: string;
  aspect: "poster" | "square";
};

const MAL_ARTWORK_HOST = "cdn.myanimelist.net";
const HARDCOVER_ARTWORK_HOST = "assets.hardcover.app";
const STEAM_ARTWORK_HOST = "media.steampowered.com";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const MAL_PATH =
  /^\/images\/anime\/(?:[a-z0-9._~-]+\/){1,4}[a-z0-9._~-]+\.(?:jpe?g|png|webp)$/i;
const HARDCOVER_PATH =
  /^\/[a-z0-9._~!$&'()+,;=:@%/-]{1,1800}\.(?:jpe?g|png|webp)$/i;
const STEAM_ICON_HASH = /^[a-f0-9]{40}$/i;
const DECIMAL_ID = /^[1-9]\d{0,24}$/;

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
  if (!isStoredArtworkRef(value) || !DECIMAL_ID.test(itemId)) return null;
  const expectedKind =
    provider === "myanimelist"
      ? "mal-cover"
      : provider === "hardcover"
        ? "hardcover-cover"
        : "steam-icon";
  if (value.kind !== expectedKind) return null;
  if (value.kind === "steam-icon" && value.appId !== itemId) return null;
  return {
    src: `/api/connector-artwork/${provider}/${itemId}`,
    aspect: provider === "steam" ? "square" : "poster",
  };
}

export function resolveArtworkFromSnapshot(
  provider: ConnectorProvider,
  payload: Record<string, unknown>,
  itemId: string,
): ResolvedArtwork | null {
  if (!DECIMAL_ID.test(itemId) || !Array.isArray(payload.library)) return null;

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
  return {
    upstreamUrl: `https://${STEAM_ARTWORK_HOST}/steamcommunity/public/images/apps/${artwork.appId}/${artwork.hash}.jpg`,
    cacheIdentity: `${artwork.kind}:${artwork.appId}:${artwork.hash}`,
    aspect: "square",
  };
}
