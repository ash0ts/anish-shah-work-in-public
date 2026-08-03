export type PlayRouteSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type CollectionRouteProvider =
  | "myanimelist"
  | "hardcover"
  | "steam";

export type CollectionRouteQuery = {
  query: string;
  filter: string;
  sort: string;
  page: number;
  pageSize: 12 | 24 | 36;
};

export type DiscogsRouteQuery = {
  query: string;
  format: string;
  decade: string;
  sort: string;
  page: number;
  pageSize: 12 | 24 | 36;
};

const PAGE_SIZES = new Set([12, 24, 36]);
const MAX_PAGE = 10_000;
const MAX_QUERY_LENGTH = 80;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const SAFE_TOKEN = /^[a-z0-9-]{1,64}$/;

const COLLECTION_SORTS = {
  myanimelist: new Set(["recent", "title", "score", "year"]),
  hardcover: new Set(["recent", "title", "rating"]),
  steam: new Set(["playtime", "recent", "title"]),
} as const satisfies Record<CollectionRouteProvider, ReadonlySet<string>>;

const DISCOGS_SORTS = new Set(["title", "artist", "year"]);

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function boundedQuery(value: string): string {
  const normalized = value.trim();
  if (CONTROL_CHARACTER.test(normalized)) return "";
  return normalized.slice(0, MAX_QUERY_LENGTH);
}

function safeToken(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return SAFE_TOKEN.test(normalized) ? normalized : "";
}

function allowedToken(value: string, allowed: ReadonlySet<string>): string {
  const normalized = safeToken(value);
  return allowed.has(normalized) ? normalized : "";
}

function boundedPage(value: string): number {
  if (!/^[1-9]\d{0,4}$/.test(value)) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed <= MAX_PAGE ? parsed : 1;
}

function pageSize(value: string): 12 | 24 | 36 {
  if (!/^(?:12|24|36)$/.test(value)) return 12;
  const parsed = Number(value);
  return PAGE_SIZES.has(parsed) ? (parsed as 12 | 24 | 36) : 12;
}

export function collectionQueryFrom(
  values: PlayRouteSearchParams,
  provider: CollectionRouteProvider,
): CollectionRouteQuery {
  return {
    query: boundedQuery(firstValue(values.q)),
    filter: safeToken(firstValue(values.filter)),
    sort: allowedToken(firstValue(values.sort), COLLECTION_SORTS[provider]),
    page: boundedPage(firstValue(values.page)),
    pageSize: pageSize(firstValue(values.pageSize)),
  };
}

export function discogsQueryFrom(
  values: PlayRouteSearchParams,
): DiscogsRouteQuery {
  return {
    query: boundedQuery(firstValue(values.q)),
    format: safeToken(firstValue(values.format)),
    decade: safeToken(firstValue(values.decade)),
    sort: allowedToken(firstValue(values.sort), DISCOGS_SORTS),
    page: boundedPage(firstValue(values.page)),
    pageSize: pageSize(firstValue(values.pageSize)),
  };
}

export function collectionQueryFromGallery(
  gallery: {
    query: string;
    filter: string;
    sort: string;
    page: number;
    pageSize: 12 | 24 | 36;
  },
  provider: CollectionRouteProvider,
): CollectionRouteQuery {
  return collectionQueryFrom(
    {
      q: gallery.query,
      filter: gallery.filter,
      sort: gallery.sort,
      page: String(gallery.page),
      pageSize: String(gallery.pageSize),
    },
    provider,
  );
}

export function discogsQueryFromGallery(gallery: {
  query: string;
  format: string;
  decade: string;
  sort: string;
  page: number;
  pageSize: 12 | 24 | 36;
}): DiscogsRouteQuery {
  return discogsQueryFrom({
    q: gallery.query,
    format: gallery.format,
    decade: gallery.decade,
    sort: gallery.sort,
    page: String(gallery.page),
    pageSize: String(gallery.pageSize),
  });
}
