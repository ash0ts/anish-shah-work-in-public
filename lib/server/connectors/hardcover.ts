import {
  ConnectorFetchError,
  type ConnectorFetchResult,
  type HardcoverCredential,
} from "./types";
import { normalizeConnectorProfileUrl } from "./public-payload-policy";

const HARDCOVER_ENDPOINT = "https://api.hardcover.app/v1/graphql";

type GraphQlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type HardcoverBook = {
  status_id?: number;
  rating?: number;
  date_updated?: string;
  book?: {
    id?: number;
    title?: string;
    slug?: string;
  };
};

export function normalizeHardcoverAuthorization(value: string): string {
  const token = value
    .trim()
    .replace(/^Bearer(?:\s+|$)/i, "")
    .trim();
  if (!token || token.length > 8192 || /\s/.test(token)) return "";
  return `Bearer ${token}`;
}

function hardcoverStatus(status: number | undefined): string {
  const statuses: Record<number, string> = {
    1: "Want to read",
    2: "Currently reading",
    3: "Read",
    4: "Did not finish",
  };
  return statuses[status ?? -1] ?? "Other";
}

async function queryHardcover<T>(
  authorization: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(HARDCOVER_ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      authorization,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "Anish-Shah-personal-site/1.0",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new ConnectorFetchError(
      response.status === 401
        ? "Hardcover authorization needs to be renewed."
        : "Hardcover could not be synchronized.",
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

  const body = (await response.json()) as GraphQlResponse<T>;
  if (!body.data || body.errors?.length) {
    throw new ConnectorFetchError(
      "Hardcover returned an unexpected GraphQL response.",
      { code: "provider_schema_changed" },
    );
  }

  return body.data;
}

export async function fetchHardcoverSnapshot(
  credential: HardcoverCredential,
): Promise<ConnectorFetchResult> {
  const authorization = normalizeHardcoverAuthorization(
    credential.authorization,
  );
  if (!authorization) {
    throw new ConnectorFetchError(
      "Hardcover authorization token is empty or invalid.",
      {
        code: "credential_invalid",
      },
    );
  }

  const identity = await queryHardcover<{
    me?: Array<{ id?: number; username?: string }> | { id?: number; username?: string };
  }>(
    authorization,
    `query Viewer {
      me {
        id
        username
      }
    }`,
  );
  const viewer = Array.isArray(identity.me) ? identity.me[0] : identity.me;
  if (!viewer?.id) {
    throw new ConnectorFetchError(
      "Hardcover did not return the authenticated reader.",
      { code: "provider_schema_changed" },
    );
  }
  const username =
    typeof viewer.username === "string" &&
    /^[a-z0-9_-]{1,64}$/i.test(viewer.username.trim())
      ? viewer.username.trim()
      : null;

  const library = await queryHardcover<{ user_books?: HardcoverBook[] }>(
    authorization,
    `query Library($userId: Int!) {
      user_books(
        where: {user_id: {_eq: $userId}}
        order_by: {date_updated: desc}
        limit: 250
      ) {
        status_id
        rating
        date_updated
        book {
          id
          title
          slug
        }
      }
    }`,
    { userId: viewer.id },
  );
  if (!Array.isArray(library.user_books)) {
    throw new ConnectorFetchError(
      "Hardcover returned an unexpected library response.",
      { code: "provider_schema_changed" },
    );
  }

  const seenBookIds = new Set<number>();
  const uniqueBooks = library.user_books.filter((entry) => {
    const id = entry.book?.id;
    if (!id || seenBookIds.has(id)) return false;
    seenBookIds.add(id);
    return true;
  });
  const statusCounts = new Map<string, number>();
  for (const entry of uniqueBooks) {
    const status = hardcoverStatus(entry.status_id);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  const recent = uniqueBooks.slice(0, 12).flatMap((entry) => {
    if (!entry.book?.id || !entry.book.title) return [];
    return [
      {
        id: String(entry.book.id),
        title: entry.book.title,
        slug: entry.book.slug ?? null,
        status: hardcoverStatus(entry.status_id),
        rating: entry.rating ?? null,
        updatedAt: entry.date_updated ?? null,
      },
    ];
  });

  return {
    publicPayload: {
      provider: "hardcover",
      profileUrl: normalizeConnectorProfileUrl(
        "hardcover",
        username ? `https://hardcover.app/@${username}` : undefined,
      ),
      username,
      coverage:
        uniqueBooks.length === 250
          ? "250 most recently updated books"
          : "Current library",
      status: [...statusCounts.entries()]
        .sort(
          (left, right) =>
            right[1] - left[1] || left[0].localeCompare(right[0]),
        )
        .map(([label, count]) => ({ label, count })),
      recent,
    },
    itemCount: uniqueBooks.length,
  };
}
