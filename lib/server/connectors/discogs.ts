import {
  buildDiscogsAuthorizationHeader,
  DISCOGS_USER_AGENT,
  isDiscogsOAuthCredential,
} from "./discogs-oauth";
import { normalizeConnectorProfileUrl } from "./public-payload-policy";
import {
  ConnectorFetchError,
  type ConnectorFetchResult,
  type DiscogsOAuthCredential,
} from "./types";

const DISCOGS_API_ORIGIN = "https://api.discogs.com";
const IDENTITY_PATH = "/oauth/identity";
const COLLECTION_PAGE_SIZE = 100;
const MAX_COLLECTION_ITEMS = 5_000;
const MAX_IDENTITY_BYTES = 64 * 1024;
const MAX_COLLECTION_PAGE_BYTES = 2_500_000;
// D1 caps a complete table row at 2,000,000 bytes. Keep the retained release
// catalog below 1.5 MB so the derived distributions, timestamps, and row
// metadata still fit without relying on a provider-specific database limit.
export const MAX_NORMALIZED_COLLECTION_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_TITLE_LENGTH = 512;
const MAX_ARTIST_LENGTH = 512;
const MAX_ARTISTS = 64;
const MAX_FORMAT_RECORDS = 64;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const DECIMAL_ID = /^[1-9]\d{0,24}$/;
const UTF8_ENCODER = new TextEncoder();

export const DISCOGS_FORMATS = [
  "Box set",
  "Vinyl",
  "CD",
  "Cassette",
  "Other",
] as const;

export type DiscogsFormat = (typeof DISCOGS_FORMATS)[number];

type DiscogsReleaseSummary = {
  releaseId: string;
  title: string;
  artists: string[];
  releaseYear: number | null;
  format: DiscogsFormat;
  copyCount: number;
};

type CollectionPagination = {
  page: number;
  pages: number;
  perPage: number;
  items: number;
};

type DiscogsResponse<T> = {
  body: T;
  etag?: string;
  rateLimitExhausted: boolean;
  retryAfterSeconds: number | null;
};

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
    return schemaError(`Discogs returned an unexpected ${field}.`);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    return schemaError(`Discogs returned an unexpected ${field}.`);
  }
  return normalized;
}

function requiredPublicCatalogString(
  value: unknown,
  maximumLength: number,
  field: string,
): string {
  return requiredString(value, maximumLength, field)
    .replaceAll("<", "‹")
    .replaceAll(">", "›");
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
    return schemaError(`Discogs returned an unexpected ${field}.`);
  }
  return value;
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
  context: string,
): Promise<unknown> {
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLocaleLowerCase();
  if (mediaType !== "application/json") {
    return schemaError(`Discogs returned an unexpected ${context} response.`);
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > maximumBytes)
  ) {
    throw new ConnectorFetchError(
      `Discogs returned too much ${context} data.`,
      { code: "provider_payload_too_large" },
    );
  }
  if (!response.body) {
    return schemaError(`Discogs returned an unexpected ${context} response.`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ConnectorFetchError(
          `Discogs returned too much ${context} data.`,
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
    return schemaError(`Discogs returned an unexpected ${context} response.`);
  }
}

function rateLimitRemaining(response: Response): number | null {
  const value = response.headers.get("x-discogs-ratelimit-remaining");
  if (value === null) return null;
  return /^\d{1,7}$/.test(value) ? Number(value) : null;
}

const MAX_RETRY_AFTER_SECONDS = 7 * 24 * 60 * 60;

export function parseDiscogsRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 128) return null;
  if (/^\d{1,10}$/.test(candidate)) {
    const seconds = Number(candidate);
    return Number.isSafeInteger(seconds) &&
        seconds >= 1 &&
        seconds <= MAX_RETRY_AFTER_SECONDS
      ? seconds
      : null;
  }
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp) || timestamp <= now) return null;
  const seconds = Math.ceil((timestamp - now) / 1_000);
  return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : null;
}

async function discogsGet<T>(
  url: URL,
  credential: DiscogsOAuthCredential,
  context: string,
  maximumBytes: number,
): Promise<DiscogsResponse<T>> {
  const authorization = await buildDiscogsAuthorizationHeader({
    method: "GET",
    url: url.toString(),
    credential,
  });
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "User-Agent": DISCOGS_USER_AGENT,
      },
    });
  } catch {
    throw new ConnectorFetchError(
      "Discogs synchronization is temporarily unavailable.",
      { code: "provider_error", retryable: true },
    );
  }
  if (!response.ok) {
    const retryAfterSeconds =
      response.status === 429
        ? parseDiscogsRetryAfter(response.headers.get("retry-after")) ?? 3_600
        : null;
    throw new ConnectorFetchError(
      response.status === 401
        ? "Discogs authorization needs to be renewed."
        : response.status === 429
          ? "Discogs is temporarily rate-limiting synchronization."
          : "Discogs could not be synchronized.",
      {
        code:
          response.status === 401
            ? "reauthorization_required"
            : response.status === 429
              ? "rate_limited"
              : "provider_error",
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterSeconds,
      },
    );
  }
  return {
    body: (await boundedJson(response, maximumBytes, context)) as T,
    etag: response.headers.get("etag") ?? undefined,
    rateLimitExhausted: rateLimitRemaining(response) === 0,
    retryAfterSeconds: parseDiscogsRetryAfter(
      response.headers.get("retry-after"),
    ),
  };
}

function collectionUrl(username: string, page: number): URL {
  const url = new URL(
    `/users/${encodeURIComponent(username)}/collection/folders/0/releases`,
    DISCOGS_API_ORIGIN,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(COLLECTION_PAGE_SIZE));
  return url;
}

function normalizeIdentity(value: unknown): {
  username: string;
  profileUrl: string;
} {
  if (!isRecord(value)) {
    return schemaError("Discogs returned an unexpected identity response.");
  }
  const username = requiredString(value.username, 64, "username");
  if (!/^[A-Za-z0-9._~-]{1,64}$/.test(username)) {
    return schemaError("Discogs returned an unexpected username.");
  }
  const profileUrl = normalizeConnectorProfileUrl(
    "discogs",
    `https://www.discogs.com/user/${username}/collection`,
  );
  if (!profileUrl) {
    return schemaError("Discogs returned an unexpected username.");
  }
  return { username, profileUrl };
}

function normalizePagination(
  value: unknown,
  requestedPage: number,
): CollectionPagination {
  if (!isRecord(value)) {
    return schemaError("Discogs returned unexpected collection pagination.");
  }
  const items = requiredInteger(
    value.items,
    0,
    100_000_000,
    "collection item count",
  );
  if (items > MAX_COLLECTION_ITEMS) {
    throw new ConnectorFetchError(
      "The Discogs collection is larger than the synchronization limit.",
      { code: "collection_too_large" },
    );
  }
  const page = requiredInteger(value.page, 1, 50, "collection page");
  const pages = requiredInteger(value.pages, 0, 50, "collection page count");
  const perPage = requiredInteger(
    value.per_page,
    1,
    COLLECTION_PAGE_SIZE,
    "collection page size",
  );
  const expectedPages = items === 0 ? 0 : Math.ceil(items / perPage);
  if (
    page !== requestedPage ||
    perPage !== COLLECTION_PAGE_SIZE ||
    !(
      pages === expectedPages ||
      (items === 0 && requestedPage === 1 && pages === 1)
    )
  ) {
    return schemaError("Discogs returned inconsistent collection pagination.");
  }
  return { page, pages, perPage, items };
}

function formatText(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_FORMAT_RECORDS) {
    return schemaError("Discogs returned an unexpected format list.");
  }
  const values: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return schemaError("Discogs returned an unexpected format record.");
    }
    if (entry.name !== undefined && entry.name !== null) {
      values.push(requiredString(entry.name, 128, "format name"));
    }
    if (entry.descriptions !== undefined && entry.descriptions !== null) {
      if (
        !Array.isArray(entry.descriptions) ||
        entry.descriptions.length > 64
      ) {
        return schemaError("Discogs returned unexpected format descriptions.");
      }
      for (const description of entry.descriptions) {
        values.push(requiredString(description, 128, "format description"));
      }
    }
  }
  return values;
}

export function classifyDiscogsFormat(value: unknown): DiscogsFormat {
  const descriptors = formatText(value).map((entry) =>
    entry.toLocaleLowerCase(),
  );
  if (descriptors.some((entry) => /\bbox(?: set)?\b/.test(entry))) {
    return "Box set";
  }
  if (
    descriptors.some((entry) =>
      /(?:\bvinyl\b|\blp\b|\b(?:7|10|12)\")/.test(entry),
    )
  ) {
    return "Vinyl";
  }
  if (descriptors.some((entry) => /\b(?:cd|cdr|cd-r)\b/.test(entry))) {
    return "CD";
  }
  if (descriptors.some((entry) => /\bcassette\b/.test(entry))) {
    return "Cassette";
  }
  return "Other";
}

function normalizeArtists(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ARTISTS) {
    return schemaError("Discogs returned an unexpected artist list.");
  }
  const artists: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return schemaError("Discogs returned an unexpected artist record.");
    }
    const name = requiredPublicCatalogString(
      entry.name,
      MAX_ARTIST_LENGTH,
      "artist name",
    );
    if (!artists.includes(name)) artists.push(name);
  }
  return artists;
}

function normalizeRelease(value: unknown): DiscogsReleaseSummary {
  if (!isRecord(value) || !isRecord(value.basic_information)) {
    return schemaError("Discogs returned an unexpected collection item.");
  }
  const information = value.basic_information;
  const rawId = information.id ?? value.id;
  const releaseId =
    typeof rawId === "number" &&
    Number.isSafeInteger(rawId) &&
    rawId > 0
      ? String(rawId)
      : typeof rawId === "string" && DECIMAL_ID.test(rawId)
        ? rawId
        : schemaError("Discogs returned an unexpected release ID.");
  const year = information.year;
  const releaseYear =
    year === undefined || year === null || year === 0
      ? null
      : requiredInteger(year, 1_000, 9_999, "release year");
  return {
    releaseId,
    title: requiredPublicCatalogString(
      information.title,
      MAX_TITLE_LENGTH,
      "release title",
    ),
    artists: normalizeArtists(information.artists),
    releaseYear,
    format: classifyDiscogsFormat(information.formats),
    copyCount: 1,
  };
}

function normalizedReleaseBytes(release: DiscogsReleaseSummary): number {
  return UTF8_ENCODER.encode(JSON.stringify(release)).byteLength;
}

function sameReleaseMetadata(
  left: DiscogsReleaseSummary,
  right: DiscogsReleaseSummary,
): boolean {
  return (
    left.title === right.title &&
    left.releaseYear === right.releaseYear &&
    left.format === right.format &&
    left.artists.length === right.artists.length &&
    left.artists.every((artist, index) => artist === right.artists[index])
  );
}

function decadeForYear(year: number | null): string {
  return year === null ? "Undated" : `${Math.floor(year / 10) * 10}s`;
}

function countSeries(
  counts: ReadonlyMap<string, number>,
): Array<{ label: string; count: number }> {
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

function buildPublicPayload(
  profileUrl: string,
  releases: DiscogsReleaseSummary[],
  physicalItems: number,
): Record<string, unknown> {
  const formats = new Map<string, number>(
    DISCOGS_FORMATS.map((format) => [format, 0]),
  );
  const decades = new Map<string, number>();
  const matrix = new Map<string, number>();
  for (const release of releases) {
    formats.set(
      release.format,
      (formats.get(release.format) ?? 0) + release.copyCount,
    );
    const decade = decadeForYear(release.releaseYear);
    decades.set(decade, (decades.get(decade) ?? 0) + release.copyCount);
    const key = `${release.format}\u0000${decade}`;
    matrix.set(key, (matrix.get(key) ?? 0) + release.copyCount);
  }
  const orderedDecades = new Map(
    [...decades.entries()].sort(([left], [right]) => {
      if (left === "Undated") return 1;
      if (right === "Undated") return -1;
      return right.localeCompare(left);
    }),
  );
  const formatOrder = new Map(
    DISCOGS_FORMATS.map((format, index) => [format, index]),
  );
  const decadeOrder = new Map(
    [...orderedDecades.keys()].map((decade, index) => [decade, index]),
  );
  const formatDecadeMatrix = [...matrix.entries()]
    .map(([key, count]) => {
      const [format, decade] = key.split("\u0000");
      return { format, decade, count };
    })
    .sort(
      (left, right) =>
        (formatOrder.get(left.format as DiscogsFormat) ?? 99) -
          (formatOrder.get(right.format as DiscogsFormat) ?? 99) ||
        (decadeOrder.get(left.decade) ?? 99) -
          (decadeOrder.get(right.decade) ?? 99),
    );

  return {
    provider: "discogs",
    snapshotVersion: 1,
    profileUrl,
    coverage: "Physical releases returned from the public Discogs collection",
    totals: {
      physicalItems,
      distinctReleases: releases.length,
    },
    formats: countSeries(formats),
    decades: countSeries(orderedDecades),
    formatDecadeMatrix,
    library: releases,
  };
}

export async function fetchDiscogsSnapshot(
  credential: DiscogsOAuthCredential,
): Promise<ConnectorFetchResult> {
  if (!isDiscogsOAuthCredential(credential)) {
    throw new ConnectorFetchError(
      "Discogs authorization is empty or invalid.",
      { code: "credential_invalid" },
    );
  }

  const identityResponse = await discogsGet<unknown>(
    new URL(IDENTITY_PATH, DISCOGS_API_ORIGIN),
    credential,
    "identity",
    MAX_IDENTITY_BYTES,
  );
  const identity = normalizeIdentity(identityResponse.body);
  if (identityResponse.rateLimitExhausted) {
    throw new ConnectorFetchError(
      "Discogs is temporarily rate-limiting synchronization.",
      {
        code: "rate_limited",
        httpStatus: 429,
        retryable: true,
        retryAfterSeconds: identityResponse.retryAfterSeconds ?? 3_600,
      },
    );
  }

  const releases = new Map<string, DiscogsReleaseSummary>();
  let firstPagination: CollectionPagination | null = null;
  let firstEtag: string | undefined;
  let physicalItemsRead = 0;
  let normalizedCollectionBytes = 0;
  for (let page = 1; page <= 50; page += 1) {
    const response = await discogsGet<unknown>(
      collectionUrl(identity.username, page),
      credential,
      "collection",
      MAX_COLLECTION_PAGE_BYTES,
    );
    if (!isRecord(response.body)) {
      return schemaError("Discogs returned an unexpected collection response.");
    }
    const pagination = normalizePagination(response.body.pagination, page);
    if (!firstPagination) {
      firstPagination = pagination;
      firstEtag = response.etag;
    } else if (
      pagination.pages !== firstPagination.pages ||
      pagination.perPage !== firstPagination.perPage ||
      pagination.items !== firstPagination.items
    ) {
      return schemaError("Discogs returned inconsistent collection pagination.");
    }
    if (
      !Array.isArray(response.body.releases) ||
      response.body.releases.length > COLLECTION_PAGE_SIZE
    ) {
      return schemaError("Discogs returned an unexpected collection page.");
    }
    const finalPage = Math.max(1, pagination.pages);
    const expectedPageItems =
      page < finalPage
        ? COLLECTION_PAGE_SIZE
        : pagination.items - COLLECTION_PAGE_SIZE * (finalPage - 1);
    if (response.body.releases.length !== expectedPageItems) {
      return schemaError("Discogs returned inconsistent collection pagination.");
    }
    for (const value of response.body.releases) {
      const release = normalizeRelease(value);
      const existing = releases.get(release.releaseId);
      if (existing) {
        if (!sameReleaseMetadata(existing, release)) {
          return schemaError("Discogs returned conflicting release metadata.");
        }
        const previousBytes = normalizedReleaseBytes(existing);
        existing.copyCount += 1;
        normalizedCollectionBytes +=
          normalizedReleaseBytes(existing) - previousBytes;
      } else {
        normalizedCollectionBytes += normalizedReleaseBytes(release);
        releases.set(release.releaseId, release);
      }
      if (normalizedCollectionBytes > MAX_NORMALIZED_COLLECTION_BYTES) {
        throw new ConnectorFetchError(
          "Discogs returned too much normalized collection data.",
          { code: "provider_payload_too_large" },
        );
      }
      physicalItemsRead += 1;
      if (physicalItemsRead > MAX_COLLECTION_ITEMS) {
        throw new ConnectorFetchError(
          "The Discogs collection is larger than the synchronization limit.",
          { code: "collection_too_large" },
        );
      }
    }
    if (page >= finalPage) break;
    if (response.rateLimitExhausted) {
      throw new ConnectorFetchError(
        "Discogs is temporarily rate-limiting synchronization.",
        {
          code: "rate_limited",
          httpStatus: 429,
          retryable: true,
          retryAfterSeconds: response.retryAfterSeconds ?? 3_600,
        },
      );
    }
  }
  if (!firstPagination || physicalItemsRead !== firstPagination.items) {
    return schemaError("Discogs returned inconsistent collection pagination.");
  }

  const library = [...releases.values()].sort(
    (left, right) =>
      (left.artists[0] ?? "").localeCompare(right.artists[0] ?? "") ||
      left.title.localeCompare(right.title) ||
      left.releaseId.localeCompare(right.releaseId, undefined, {
        numeric: true,
      }),
  );
  return {
    publicPayload: buildPublicPayload(
      identity.profileUrl,
      library,
      physicalItemsRead,
    ),
    itemCount: physicalItemsRead,
    etag: firstEtag,
  };
}
