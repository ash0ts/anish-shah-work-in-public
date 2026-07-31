import {
  ConnectorFetchError,
  type ConnectorFetchResult,
  type HardcoverCredential,
} from "./types";
import { normalizeConnectorProfileUrl } from "./public-payload-policy";

const HARDCOVER_ENDPOINT = "https://api.hardcover.app/v1/graphql";
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_LIBRARY_ITEMS = 250;
const MAX_IDENTITY_ROWS = 10;
const MAX_GRAPHQL_ERRORS = 20;
const MAX_TITLE_LENGTH = 512;
const MAX_SLUG_LENGTH = 240;
const GRAPHQL_INT_MAX = 2_147_483_647;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

type NormalizedHardcoverBook = {
  statusId?: number;
  rating?: number;
  updatedAt?: string;
  book?: {
    id?: number;
    title?: string;
    slug?: string;
  };
};

function providerSchemaError(message: string): never {
  throw new ConnectorFetchError(message, {
    code: "provider_schema_changed",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function boundedJsonResponse(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RESPONSE_BYTES
  ) {
    throw new ConnectorFetchError("Hardcover returned too much data.", {
      code: "provider_payload_too_large",
    });
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new ConnectorFetchError("Hardcover returned too much data.", {
      code: "provider_payload_too_large",
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return providerSchemaError(
      "Hardcover returned an unexpected GraphQL response.",
    );
  }
}

function optionalBoundedString(
  value: unknown,
  maximumLength: number,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    return providerSchemaError(
      `Hardcover returned an unexpected ${field} value.`,
    );
  }
  const normalized = value.trim();
  if (
    normalized.length > maximumLength ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    return providerSchemaError(
      `Hardcover returned an unexpected ${field} value.`,
    );
  }
  return normalized || undefined;
}

function optionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return providerSchemaError(
      `Hardcover returned an unexpected ${field} value.`,
    );
  }
  return value;
}

function optionalRating(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 5
  ) {
    return providerSchemaError(
      "Hardcover returned an unexpected rating value.",
    );
  }
  return value;
}

function optionalDateTime(value: unknown): string | undefined {
  const normalized = optionalBoundedString(value, 64, "update date");
  if (!normalized) return undefined;
  if (!ISO_DATE_TIME.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    return providerSchemaError(
      "Hardcover returned an unexpected update date value.",
    );
  }
  return normalized;
}

function normalizeHardcoverBook(value: unknown): NormalizedHardcoverBook {
  if (!isRecord(value)) {
    return providerSchemaError(
      "Hardcover returned an unexpected library item.",
    );
  }

  let book: NormalizedHardcoverBook["book"];
  if (value.book !== undefined && value.book !== null) {
    if (!isRecord(value.book)) {
      return providerSchemaError(
        "Hardcover returned an unexpected book record.",
      );
    }
    book = {
      id: optionalInteger(value.book.id, 1, GRAPHQL_INT_MAX, "book ID"),
      title: optionalBoundedString(
        value.book.title,
        MAX_TITLE_LENGTH,
        "book title",
      ),
      slug: optionalBoundedString(
        value.book.slug,
        MAX_SLUG_LENGTH,
        "book slug",
      ),
    };
  }

  return {
    statusId: optionalInteger(
      value.status_id,
      0,
      GRAPHQL_INT_MAX,
      "reading status",
    ),
    rating: optionalRating(value.rating),
    updatedAt: optionalDateTime(value.updated_at),
    book,
  };
}

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

  const body = await boundedJsonResponse(response);
  if (!isRecord(body)) {
    throw new ConnectorFetchError(
      "Hardcover returned an unexpected GraphQL response.",
      { code: "provider_schema_changed" },
    );
  }
  if (
    body.errors !== undefined &&
    (!Array.isArray(body.errors) ||
      body.errors.length > MAX_GRAPHQL_ERRORS)
  ) {
    return providerSchemaError(
      "Hardcover returned an unexpected GraphQL response.",
    );
  }
  if ((body.errors as unknown[] | undefined)?.length || !isRecord(body.data)) {
    throw new ConnectorFetchError(
      "Hardcover returned an unexpected GraphQL response.",
      { code: "provider_schema_changed" },
    );
  }

  return body.data as T;
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
  const identityRows = Array.isArray(identity.me)
    ? identity.me
    : identity.me === undefined || identity.me === null
      ? []
      : [identity.me];
  if (
    identityRows.length > MAX_IDENTITY_ROWS ||
    identityRows.some((row) => !isRecord(row))
  ) {
    return providerSchemaError(
      "Hardcover returned an unexpected reader list.",
    );
  }
  const viewer = identityRows[0];
  if (!viewer) {
    throw new ConnectorFetchError(
      "Hardcover did not return the authenticated reader.",
      { code: "provider_schema_changed" },
    );
  }
  const viewerId = optionalInteger(
    viewer.id,
    1,
    GRAPHQL_INT_MAX,
    "reader ID",
  );
  if (viewerId === undefined) {
    throw new ConnectorFetchError(
      "Hardcover did not return the authenticated reader.",
      { code: "provider_schema_changed" },
    );
  }
  const rawUsername = optionalBoundedString(
    viewer.username,
    64,
    "reader username",
  );
  const username =
    rawUsername && /^[a-z0-9_-]{1,64}$/i.test(rawUsername)
      ? rawUsername
      : null;

  const library = await queryHardcover<{ user_books?: unknown }>(
    authorization,
    `query Library($userId: Int!) {
      user_books(
        where: {user_id: {_eq: $userId}}
        order_by: {updated_at: desc}
        limit: 250
      ) {
        status_id
        rating
        updated_at
        book {
          id
          title
          slug
        }
      }
    }`,
    { userId: viewerId },
  );
  if (
    !Array.isArray(library.user_books) ||
    library.user_books.length > MAX_LIBRARY_ITEMS
  ) {
    throw new ConnectorFetchError(
      "Hardcover returned an unexpected library response.",
      { code: "provider_schema_changed" },
    );
  }
  const normalizedBooks = library.user_books.map(normalizeHardcoverBook);

  const seenBookIds = new Set<number>();
  const uniqueBooks = normalizedBooks.filter((entry) => {
    const id = entry.book?.id;
    if (!id || seenBookIds.has(id)) return false;
    seenBookIds.add(id);
    return true;
  });
  const statusCounts = new Map<string, number>();
  for (const entry of uniqueBooks) {
    const status = hardcoverStatus(entry.statusId);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  const recent = uniqueBooks.slice(0, 12).flatMap((entry) => {
    if (!entry.book?.id || !entry.book.title) return [];
    return [
      {
        id: String(entry.book.id),
        title: entry.book.title,
        slug: entry.book.slug ?? null,
        status: hardcoverStatus(entry.statusId),
        rating: entry.rating ?? null,
        updatedAt: entry.updatedAt ?? null,
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
      coverage:
        uniqueBooks.length === MAX_LIBRARY_ITEMS
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
