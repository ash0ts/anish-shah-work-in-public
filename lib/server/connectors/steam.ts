import { normalizeConnectorProfileUrl } from "./public-payload-policy";
import {
  ConnectorFetchError,
  type ConnectorFetchResult,
  type SteamCredential,
} from "./types";

const STEAM_API_ORIGIN = "https://api.steampowered.com";
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_LIBRARY_ITEMS = 20_000;
const MAX_PUBLIC_GAMES = 8;
const MAX_PLAYTIME_MINUTES = 10_000_000;
const UINT32_MAX = 4_294_967_295;

type SteamPlayerSummary = {
  steamid?: string;
};

type SteamGame = {
  appid?: number;
  name?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
};

type PlayerSummariesResponse = {
  response?: {
    players?: SteamPlayerSummary[];
  };
};

type OwnedGamesResponse = {
  response?: {
    game_count?: number;
    games?: SteamGame[];
  };
};

type RecentlyPlayedResponse = {
  response?: {
    total_count?: number;
    games?: SteamGame[];
  };
};

export function normalizeSteamApiKey(value: string): string {
  const normalized = value.trim();
  return /^[a-f0-9]{32}$/i.test(normalized) ? normalized : "";
}

export function normalizeSteamId(value: string): string {
  const normalized = value.trim();
  return /^\d{17}$/.test(normalized) ? normalized : "";
}

function requestUrl(
  interfaceName: "ISteamUser" | "IPlayerService",
  method: string,
  version: number,
  parameters: Record<string, string>,
): string {
  const url = new URL(
    `/${interfaceName}/${method}/v${version}/`,
    STEAM_API_ORIGIN,
  );
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function steamRequest<T>(
  url: string,
  apiKey: string,
): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    // Cloudflare Workers supports follow/manual, but not RequestRedirect
    // "error". Manual keeps redirects fail-closed through the non-2xx path
    // below without making the connector incompatible with the edge runtime.
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      "x-webapi-key": apiKey,
    },
  });

  if (!response.ok) {
    throw new ConnectorFetchError(
      response.status === 401 || response.status === 403
        ? "Steam Web API authorization needs to be renewed."
        : "Steam could not be synchronized.",
      {
        code:
          response.status === 401 || response.status === 403
            ? "credential_expired"
            : response.status === 429
              ? "rate_limited"
              : "provider_error",
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
      },
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RESPONSE_BYTES
  ) {
    throw new ConnectorFetchError("Steam returned too much data.", {
      code: "provider_payload_too_large",
    });
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new ConnectorFetchError("Steam returned too much data.", {
      code: "provider_payload_too_large",
    });
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ConnectorFetchError(
      "Steam returned an unexpected response.",
      { code: "provider_schema_changed" },
    );
  }
}

function safeMinutes(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_PLAYTIME_MINUTES &&
    Number.isSafeInteger(value)
    ? value
    : 0;
}

function normalizedGame(
  value: unknown,
): {
  appId: string;
  title: string;
  totalMinutes: number;
  recentMinutes: number;
} | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const game = value as SteamGame;
  if (
    typeof game.appid !== "number" ||
    !Number.isInteger(game.appid) ||
    game.appid <= 0 ||
    game.appid > UINT32_MAX ||
    typeof game.name !== "string"
  ) {
    return null;
  }
  const title = game.name.trim();
  if (!title || title.length > 240) return null;

  return {
    appId: String(game.appid),
    title,
    totalMinutes: safeMinutes(game.playtime_forever),
    recentMinutes: safeMinutes(game.playtime_2weeks),
  };
}

function roundedHours(minutes: number): number {
  return Math.round(minutes / 60);
}

export async function fetchSteamSnapshot(
  credential: SteamCredential,
): Promise<ConnectorFetchResult> {
  const apiKey = normalizeSteamApiKey(credential.apiKey);
  const steamId = normalizeSteamId(credential.steamId);
  if (!apiKey || !steamId) {
    throw new ConnectorFetchError(
      "Steam requires a valid Web API key and SteamID64.",
      { code: "credential_invalid" },
    );
  }

  const summaries = await steamRequest<PlayerSummariesResponse>(
    requestUrl("ISteamUser", "GetPlayerSummaries", 2, {
      steamids: steamId,
    }),
    apiKey,
  );
  const players = summaries.response?.players;
  if (!Array.isArray(players) || players.length > 100) {
    throw new ConnectorFetchError(
      "Steam returned an unexpected profile response.",
      { code: "provider_schema_changed" },
    );
  }
  const player = players.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      candidate.steamid === steamId,
  );
  if (!player) {
    throw new ConnectorFetchError(
      "Steam did not return the configured profile.",
      { code: "profile_not_found" },
    );
  }

  const owned = await steamRequest<OwnedGamesResponse>(
    requestUrl("IPlayerService", "GetOwnedGames", 1, {
      input_json: JSON.stringify({
        steamid: steamId,
        include_appinfo: true,
        include_played_free_games: true,
      }),
    }),
    apiKey,
  );
  if (
    !owned.response ||
    typeof owned.response !== "object" ||
    Array.isArray(owned.response)
  ) {
    throw new ConnectorFetchError(
      "Steam game details are not publicly visible.",
      { code: "visibility_unavailable" },
    );
  }
  const rawOwnedGames = owned.response.games;
  const gameCount = owned.response.game_count;
  if (
    gameCount !== undefined &&
    (typeof gameCount !== "number" ||
      !Number.isInteger(gameCount) ||
      gameCount < 0 ||
      gameCount > MAX_LIBRARY_ITEMS)
  ) {
    throw new ConnectorFetchError(
      "Steam returned an unexpected library count.",
      { code: "provider_schema_changed" },
    );
  }
  if (
    rawOwnedGames === undefined &&
    !(typeof gameCount === "number" && gameCount === 0)
  ) {
    throw new ConnectorFetchError(
      "Steam game details are not publicly visible.",
      { code: "visibility_unavailable" },
    );
  }
  if (
    rawOwnedGames !== undefined &&
    (!Array.isArray(rawOwnedGames) ||
      rawOwnedGames.length > MAX_LIBRARY_ITEMS)
  ) {
    throw new ConnectorFetchError(
      "Steam returned an unexpected library response.",
      { code: "provider_schema_changed" },
    );
  }

  const ownedGames = (rawOwnedGames ?? []).flatMap((game) => {
    const normalized = normalizedGame(game);
    return normalized ? [normalized] : [];
  });

  const recentlyPlayed = await steamRequest<RecentlyPlayedResponse>(
    requestUrl("IPlayerService", "GetRecentlyPlayedGames", 1, {
      input_json: JSON.stringify({
        steamid: steamId,
        count: 12,
      }),
    }),
    apiKey,
  );
  if (
    !recentlyPlayed.response ||
    typeof recentlyPlayed.response !== "object" ||
    Array.isArray(recentlyPlayed.response)
  ) {
    throw new ConnectorFetchError(
      "Steam recent game details are not publicly visible.",
      { code: "visibility_unavailable" },
    );
  }
  const rawRecentGames = recentlyPlayed.response.games;
  const recentCount = recentlyPlayed.response.total_count;
  if (
    recentCount !== undefined &&
    (typeof recentCount !== "number" ||
      !Number.isInteger(recentCount) ||
      recentCount < 0 ||
      recentCount > MAX_LIBRARY_ITEMS)
  ) {
    throw new ConnectorFetchError(
      "Steam returned an unexpected recent-game count.",
      { code: "provider_schema_changed" },
    );
  }
  if (
    rawRecentGames !== undefined &&
    (!Array.isArray(rawRecentGames) ||
      rawRecentGames.length > MAX_LIBRARY_ITEMS)
  ) {
    throw new ConnectorFetchError(
      "Steam returned an unexpected recent-games response.",
      { code: "provider_schema_changed" },
    );
  }
  const recentGames = (rawRecentGames ?? [])
    .flatMap((game) => {
      const normalized = normalizedGame(game);
      return normalized ? [normalized] : [];
    })
    .slice(0, MAX_PUBLIC_GAMES);

  const topPlayed = [...ownedGames]
    .filter((game) => game.totalMinutes > 0)
    .sort(
      (left, right) =>
        right.totalMinutes - left.totalMinutes ||
        left.title.localeCompare(right.title),
    )
    .slice(0, MAX_PUBLIC_GAMES)
    .map((game) => ({
      appId: game.appId,
      title: game.title,
      hoursRounded: roundedHours(game.totalMinutes),
    }));

  const totalMinutes = ownedGames.reduce(
    (sum, game) => sum + game.totalMinutes,
    0,
  );
  const profileUrl = normalizeConnectorProfileUrl(
    "steam",
    `https://steamcommunity.com/profiles/${steamId}`,
  );
  if (!profileUrl) {
    throw new ConnectorFetchError(
      "Steam profile attribution could not be normalized.",
      { code: "public_payload_rejected" },
    );
  }

  return {
    publicPayload: {
      provider: "steam",
      profileUrl,
      coverage: "Public Steam game details returned at sync",
      totals: {
        publicGameCount: ownedGames.length,
        playedGameCount: ownedGames.filter(
          (game) => game.totalMinutes > 0,
        ).length,
        totalHoursRounded: roundedHours(totalMinutes),
      },
      topPlayed,
      recent: recentGames.map((game) => ({
        appId: game.appId,
        title: game.title,
        recentHoursRounded: roundedHours(game.recentMinutes),
        totalHoursRounded: roundedHours(game.totalMinutes),
      })),
    },
    itemCount: ownedGames.length,
  };
}
