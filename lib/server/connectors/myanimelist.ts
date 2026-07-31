import {
  ConnectorFetchError,
  type ConnectorFetchResult,
  type MyAnimeListCredential,
} from "./types";
import { normalizeConnectorProfileUrl } from "./public-payload-policy";

type MalItem = {
  node?: {
    id?: number;
    title?: string;
    start_date?: string;
    genres?: Array<{ id?: number; name?: string }>;
  };
  list_status?: {
    status?: string;
    score?: number;
    num_episodes_watched?: number;
    updated_at?: string;
  };
};

type MalPage = {
  data?: MalItem[];
  paging?: { next?: string };
};

type MalIdentity = {
  id?: number;
  name?: string;
};

const MAX_PAGES = 5;
const MAL_API_ORIGIN = "https://api.myanimelist.net";

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
  return value
    .trim()
    .replace(/^Bearer(?:\s+|$)/i, "")
    .trim();
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
  const items: MalItem[] = [];
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
  const identity = (await identityResponse.json()) as MalIdentity;
  if (
    !Number.isSafeInteger(identity.id) ||
    typeof identity.name !== "string" ||
    !identity.name.trim()
  ) {
    throw new ConnectorFetchError(
      "MyAnimeList returned an unexpected identity response.",
      { code: "provider_schema_changed" },
    );
  }
  const profileUrl = normalizeConnectorProfileUrl(
    "myanimelist",
    `https://myanimelist.net/profile/${encodeURIComponent(identity.name.trim())}`,
  );

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
    const body = (await response.json()) as MalPage;
    if (!Array.isArray(body.data)) {
      throw new ConnectorFetchError(
        "MyAnimeList returned an unexpected response.",
        { code: "provider_schema_changed" },
      );
    }

    items.push(...body.data);
    nextUrl = safeNextPage(body.paging?.next);
  }

  const statusCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const eraCounts = new Map<string, number>();

  for (const item of items) {
    const status = publicStatus(item.list_status?.status);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    for (const genre of item.node?.genres ?? []) {
      if (!genre.name) continue;
      genreCounts.set(genre.name, (genreCounts.get(genre.name) ?? 0) + 1);
    }

    const year = Number(item.node?.start_date?.slice(0, 4));
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
      (right.list_status?.updated_at ?? "").localeCompare(
        left.list_status?.updated_at ?? "",
      ),
    )
    .slice(0, 12)
    .flatMap((item) => {
      if (!item.node?.id || !item.node.title) return [];
      return [
        {
          id: String(item.node.id),
          title: item.node.title,
          status: publicStatus(item.list_status?.status),
          score: item.list_status?.score ?? null,
          episodesWatched: item.list_status?.num_episodes_watched ?? null,
          updatedAt: item.list_status?.updated_at ?? null,
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
