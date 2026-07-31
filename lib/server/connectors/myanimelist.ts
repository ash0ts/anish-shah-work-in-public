import {
  ConnectorFetchError,
  type ConnectorFetchResult,
  type MyAnimeListCredential,
} from "./types";
import { normalizeConnectorProfileUrl } from "./public-payload-policy";

type NormalizedMalItem = {
  node?: {
    id?: number;
    title?: string;
    startDate?: string;
    genres: Array<{ name: string }>;
  };
  listStatus?: {
    status?: string;
    score?: number;
    episodesWatched?: number;
    updatedAt?: string;
  };
};

const MAX_PAGES = 5;
const MAX_PAGE_ITEMS = 100;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_GENRES_PER_ITEM = 64;
const MAX_TITLE_LENGTH = 512;
const MAX_LABEL_LENGTH = 128;
const MAX_PROFILE_NAME_LENGTH = 64;
const MAX_URL_LENGTH = 2_048;
const MAX_EPISODES_WATCHED = 1_000_000;
const MAL_API_ORIGIN = "https://api.myanimelist.net";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function providerSchemaError(message: string): never {
  throw new ConnectorFetchError(message, {
    code: "provider_schema_changed",
  });
}

async function boundedJsonResponse(
  response: Response,
  context: string,
): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RESPONSE_BYTES
  ) {
    throw new ConnectorFetchError(
      `MyAnimeList returned too much ${context} data.`,
      { code: "provider_payload_too_large" },
    );
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new ConnectorFetchError(
      `MyAnimeList returned too much ${context} data.`,
      { code: "provider_payload_too_large" },
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return providerSchemaError(
      `MyAnimeList returned an unexpected ${context} response.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalBoundedString(
  value: unknown,
  maximumLength: number,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    return providerSchemaError(
      `MyAnimeList returned an unexpected ${field} value.`,
    );
  }
  const normalized = value.trim();
  if (
    normalized.length > maximumLength ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    return providerSchemaError(
      `MyAnimeList returned an unexpected ${field} value.`,
    );
  }
  return normalized || undefined;
}

function optionalSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return providerSchemaError(
      `MyAnimeList returned an unexpected ${field} value.`,
    );
  }
  return value;
}

function optionalScore(value: unknown): number | undefined {
  return optionalSafeInteger(value, 0, 10, "score");
}

function optionalPartialDate(value: unknown): string | undefined {
  const normalized = optionalBoundedString(value, 10, "start date");
  if (!normalized) return undefined;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(normalized);
  if (!match) {
    return providerSchemaError(
      "MyAnimeList returned an unexpected start date value.",
    );
  }

  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (
    year < 1_000 ||
    year > 9_999 ||
    (month !== null && (month < 1 || month > 12)) ||
    (day !== null &&
      (month === null ||
        day < 1 ||
        day > new Date(Date.UTC(year, month, 0)).getUTCDate()))
  ) {
    return providerSchemaError(
      "MyAnimeList returned an unexpected start date value.",
    );
  }
  return normalized;
}

function optionalDateTime(value: unknown): string | undefined {
  const normalized = optionalBoundedString(value, 64, "update date");
  if (!normalized) return undefined;
  if (!ISO_DATE_TIME.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    return providerSchemaError(
      "MyAnimeList returned an unexpected update date value.",
    );
  }
  return normalized;
}

function normalizeMalItem(value: unknown): NormalizedMalItem {
  if (!isRecord(value)) {
    return providerSchemaError(
      "MyAnimeList returned an unexpected library item.",
    );
  }

  let node: NormalizedMalItem["node"];
  if (value.node !== undefined && value.node !== null) {
    if (!isRecord(value.node)) {
      return providerSchemaError(
        "MyAnimeList returned an unexpected title record.",
      );
    }
    const rawGenres = value.node.genres;
    if (
      rawGenres !== undefined &&
      rawGenres !== null &&
      (!Array.isArray(rawGenres) || rawGenres.length > MAX_GENRES_PER_ITEM)
    ) {
      return providerSchemaError(
        "MyAnimeList returned an unexpected genre list.",
      );
    }
    const genres = (rawGenres ?? []).flatMap((genre) => {
      if (!isRecord(genre)) {
        return providerSchemaError(
          "MyAnimeList returned an unexpected genre record.",
        );
      }
      optionalSafeInteger(genre.id, 1, Number.MAX_SAFE_INTEGER, "genre ID");
      const name = optionalBoundedString(
        genre.name,
        MAX_LABEL_LENGTH,
        "genre name",
      );
      return name ? [{ name }] : [];
    });

    node = {
      id: optionalSafeInteger(
        value.node.id,
        1,
        Number.MAX_SAFE_INTEGER,
        "title ID",
      ),
      title: optionalBoundedString(
        value.node.title,
        MAX_TITLE_LENGTH,
        "title",
      ),
      startDate: optionalPartialDate(value.node.start_date),
      genres,
    };
  }

  let listStatus: NormalizedMalItem["listStatus"];
  if (value.list_status !== undefined && value.list_status !== null) {
    if (!isRecord(value.list_status)) {
      return providerSchemaError(
        "MyAnimeList returned an unexpected list status.",
      );
    }
    const status = optionalBoundedString(
      value.list_status.status,
      64,
      "list status",
    );
    if (status && !/^[a-z0-9_]+$/i.test(status)) {
      return providerSchemaError(
        "MyAnimeList returned an unexpected list status value.",
      );
    }
    listStatus = {
      status,
      score: optionalScore(value.list_status.score),
      episodesWatched: optionalSafeInteger(
        value.list_status.num_episodes_watched,
        0,
        MAX_EPISODES_WATCHED,
        "episode count",
      ),
      updatedAt: optionalDateTime(value.list_status.updated_at),
    };
  }

  return { node, listStatus };
}

function normalizeMalPage(value: unknown): {
  data: NormalizedMalItem[];
  nextUrl: string | null;
} {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return providerSchemaError(
      "MyAnimeList returned an unexpected library response.",
    );
  }
  if (value.data.length > MAX_PAGE_ITEMS) {
    return providerSchemaError(
      "MyAnimeList returned too many library items in one page.",
    );
  }

  let next: string | undefined;
  if (value.paging !== undefined && value.paging !== null) {
    if (!isRecord(value.paging)) {
      return providerSchemaError(
        "MyAnimeList returned an unexpected paging record.",
      );
    }
    next = optionalBoundedString(
      value.paging.next,
      MAX_URL_LENGTH,
      "paging URL",
    );
  }

  return {
    data: value.data.map(normalizeMalItem),
    nextUrl: safeNextPage(next),
  };
}

function safeNextPage(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === MAL_API_ORIGIN ? url.toString() : null;
  } catch {
    return null;
  }
}

function publicStatus(value: string | undefined): string {
  const statuses: Record<string, string> = {
    watching: "Watching",
    completed: "Completed",
    on_hold: "On hold",
    dropped: "Dropped",
    plan_to_watch: "Plan to watch",
  };
  return statuses[value ?? ""] ?? "Other";
}

export function normalizeMyAnimeListAccessToken(value: string): string {
  const normalized = value
    .trim()
    .replace(/^Bearer(?:\s+|$)/i, "")
    .trim();
  return normalized &&
    normalized.length <= 8_192 &&
    !CONTROL_CHARACTER.test(normalized) &&
    !/\s/.test(normalized)
    ? normalized
    : "";
}

export async function fetchMyAnimeListSnapshot(
  credential: MyAnimeListCredential,
): Promise<ConnectorFetchResult> {
  const accessToken = normalizeMyAnimeListAccessToken(
    credential.accessToken,
  );
  if (!accessToken) {
    throw new ConnectorFetchError("MyAnimeList access token is empty.", {
      code: "credential_invalid",
    });
  }

  const fields = [
    "id",
    "title",
    "start_date",
    "genres",
    "list_status",
  ].join(",");
  let nextUrl: string | null =
    `${MAL_API_ORIGIN}/v2/users/@me/animelist` +
    `?limit=100&sort=list_updated_at&fields=${encodeURIComponent(fields)}`;
  const items: NormalizedMalItem[] = [];
  let etag: string | undefined;
  const signal = AbortSignal.timeout(25_000);

  const identityResponse = await fetch(
    `${MAL_API_ORIGIN}/v2/users/@me?fields=id,name`,
    {
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );
  if (!identityResponse.ok) {
    throw new ConnectorFetchError(
      identityResponse.status === 401
        ? "MyAnimeList authorization needs to be renewed."
        : "MyAnimeList could not be synchronized.",
      {
        code:
          identityResponse.status === 401
            ? "credential_expired"
            : identityResponse.status === 429
              ? "rate_limited"
              : "provider_error",
        httpStatus: identityResponse.status,
        retryable:
          identityResponse.status === 429 || identityResponse.status >= 500,
      },
    );
  }
  const identity = await boundedJsonResponse(identityResponse, "identity");
  if (
    !isRecord(identity) ||
    optionalSafeInteger(
      identity.id,
      1,
      Number.MAX_SAFE_INTEGER,
      "profile ID",
    ) === undefined
  ) {
    throw new ConnectorFetchError(
      "MyAnimeList returned an unexpected identity response.",
      { code: "provider_schema_changed" },
    );
  }
  const profileName = optionalBoundedString(
    identity.name,
    MAX_PROFILE_NAME_LENGTH,
    "profile name",
  );
  if (!profileName || !/^[a-z0-9_-]+$/i.test(profileName)) {
    throw new ConnectorFetchError(
      "MyAnimeList returned an unexpected identity response.",
      { code: "provider_schema_changed" },
    );
  }
  const profileUrl = normalizeConnectorProfileUrl(
    "myanimelist",
    `https://myanimelist.net/profile/${encodeURIComponent(profileName)}`,
  );
  if (!profileUrl) {
    throw new ConnectorFetchError(
      "MyAnimeList profile attribution could not be normalized.",
      { code: "public_payload_rejected" },
    );
  }

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    const response = await fetch(nextUrl, {
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new ConnectorFetchError(
        response.status === 401
          ? "MyAnimeList authorization needs to be renewed."
          : "MyAnimeList could not be synchronized.",
        {
          code:
            response.status === 401
              ? "credential_expired"
              : response.status === 429
                ? "rate_limited"
                : "provider_error",
          httpStatus: response.status,
          retryable: response.status === 429 || response.status >= 500,
        },
      );
    }

    etag ??= response.headers.get("etag") ?? undefined;
    const body = normalizeMalPage(
      await boundedJsonResponse(response, "library"),
    );
    items.push(...body.data);
    nextUrl = body.nextUrl;
  }

  const statusCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const eraCounts = new Map<string, number>();

  for (const item of items) {
    const status = publicStatus(item.listStatus?.status);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    for (const genre of item.node?.genres ?? []) {
      if (!genre.name) continue;
      genreCounts.set(genre.name, (genreCounts.get(genre.name) ?? 0) + 1);
    }

    const year = Number(item.node?.startDate?.slice(0, 4));
    if (Number.isFinite(year)) {
      const decade = `${Math.floor(year / 10) * 10}s`;
      eraCounts.set(decade, (eraCounts.get(decade) ?? 0) + 1);
    }
  }

  const topEntries = (values: Map<string, number>, limit: number) =>
    [...values.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([label, count]) => ({ label, count }));

  const recent = [...items]
    .sort((left, right) =>
      (right.listStatus?.updatedAt ?? "").localeCompare(
        left.listStatus?.updatedAt ?? "",
      ),
    )
    .slice(0, 12)
    .flatMap((item) => {
      if (!item.node?.id || !item.node.title) return [];
      return [
        {
          id: String(item.node.id),
          title: item.node.title,
          status: publicStatus(item.listStatus?.status),
          score: item.listStatus?.score ?? null,
          episodesWatched: item.listStatus?.episodesWatched ?? null,
          updatedAt: item.listStatus?.updatedAt ?? null,
        },
      ];
    });

  return {
    publicPayload: {
      provider: "myanimelist",
      profileUrl,
      coverage:
        items.length === MAX_PAGES * 100
          ? "Most recently updated 500 entries"
          : "Current library",
      status: topEntries(statusCounts, 8),
      genres: topEntries(genreCounts, 8),
      eras: topEntries(eraCounts, 8),
      recent,
    },
    itemCount: items.length,
    etag,
  };
}
