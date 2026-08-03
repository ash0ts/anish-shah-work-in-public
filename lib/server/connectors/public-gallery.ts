import type { ConnectorProvider } from "./types";
import { publicArtworkForItem } from "./artwork";

const PAGE_SIZES = new Set([12, 24, 36]);
const DEFAULT_PAGE_SIZE = 12;
const MAX_QUERY_LENGTH = 80;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

type GalleryItem = Record<string, unknown>;

type GalleryFilter = {
  id: string;
  label: string;
  count: number;
};

type GallerySort = {
  id: string;
  label: string;
};

type GallerySpec = {
  defaultSort: string;
  sorts: GallerySort[];
  filters: GalleryFilter[];
  matchesFilter: (item: GalleryItem, filter: string) => boolean;
  compare: (left: GalleryItem, right: GalleryItem, sort: string) => number;
};

export function connectorSnapshotNeedsUpgrade(
  payload: Record<string, unknown>,
): boolean {
  if (payload.provider === "spotify") {
    return (
      payload.snapshotVersion !== 1 ||
      typeof payload.windows !== "object" ||
      payload.windows === null
    );
  }
  return payload.snapshotVersion !== 3 || !Array.isArray(payload.library);
}

export function projectConnectorSnapshotForPublic(
  provider: ConnectorProvider,
  payload: Record<string, unknown>,
  searchParams: URLSearchParams,
): Record<string, unknown> {
  if (provider === "spotify") {
    return projectSpotifySnapshot(payload);
  }
  const { library: rawLibrary, ...summary } = payload;
  if (!Array.isArray(rawLibrary)) {
    return {
      ...summary,
      gallery: {
        ready: false,
        items: [],
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        totalItems: 0,
        libraryTotal: 0,
        totalPages: 1,
        query: "",
        filter: "all",
        sort: "recent",
        filters: [],
        sorts: [],
      },
    };
  }

  const library = rawLibrary.filter(isGalleryItem);
  const spec = gallerySpec(provider, library);
  const query = safeQuery(searchParams.get("q"));
  const requestedFilter = safeToken(searchParams.get("filter"));
  const allowedFilters = new Set([
    "all",
    ...spec.filters.map((filter) => filter.id),
  ]);
  const filter = allowedFilters.has(requestedFilter)
    ? requestedFilter
    : "all";
  const allowedSorts = new Set(spec.sorts.map((sort) => sort.id));
  const requestedSort = safeToken(searchParams.get("sort"));
  const sort = allowedSorts.has(requestedSort)
    ? requestedSort
    : spec.defaultSort;
  const pageSizeCandidate = Number.parseInt(
    searchParams.get("pageSize") ?? "",
    10,
  );
  const pageSize = PAGE_SIZES.has(pageSizeCandidate)
    ? pageSizeCandidate
    : DEFAULT_PAGE_SIZE;

  const normalizedQuery = query.toLocaleLowerCase();
  const filtered = library
    .filter((item) => {
      const title = stringValue(item.title);
      return (
        (!normalizedQuery ||
          title.toLocaleLowerCase().includes(normalizedQuery)) &&
        spec.matchesFilter(item, filter)
      );
    })
    .sort((left, right) => spec.compare(left, right, sort));

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = positiveInteger(searchParams.get("page"));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;

  return {
    ...summary,
    gallery: {
      ready: true,
      items: filtered
        .slice(start, start + pageSize)
        .map((item) => projectGalleryItem(provider, item)),
      page,
      pageSize,
      totalItems: filtered.length,
      libraryTotal: library.length,
      totalPages,
      query,
      filter,
      sort,
      filters: [
        { id: "all", label: "All", count: library.length },
        ...spec.filters,
      ],
      sorts: spec.sorts,
    },
  };
}

function projectSpotifySnapshot(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const windows = payload.windows;
  if (typeof windows !== "object" || windows === null || Array.isArray(windows)) {
    return { provider: "spotify", windows: {} };
  }
  return {
    provider: "spotify",
    snapshotVersion: 1,
    profileUrl: payload.profileUrl,
    coverage: payload.coverage,
    syncedAt: payload.syncedAt,
    freshUntil: payload.freshUntil,
    windows: Object.fromEntries(
      ["short_term", "medium_term", "long_term"].map(
        (range) => {
          const rawWindow = (windows as Record<string, unknown>)[range];
          if (typeof rawWindow !== "object" || rawWindow === null) {
            return [range, { tracks: [] }];
          }
          const tracks = (rawWindow as Record<string, unknown>).tracks;
          return [
            range,
            {
              tracks: Array.isArray(tracks)
                ? tracks.flatMap((track) => {
                    if (typeof track !== "object" || track === null) return [];
                    const record = track as Record<string, unknown>;
                    const id = stringValue(record.id);
                    const album = record.album;
                    if (typeof album !== "object" || album === null) {
                      return [];
                    }
                    const albumRecord = album as Record<string, unknown>;
                    const storedArtwork = albumRecord.artwork;
                    const artwork = publicArtworkForItem(
                      "spotify",
                      id,
                      storedArtwork,
                    );
                    return [
                      {
                        id,
                        position: record.position,
                        title: record.title,
                        artists: record.artists,
                        album: {
                          id: albumRecord.id,
                          title: albumRecord.title,
                          releaseYear: albumRecord.releaseYear,
                          ...(artwork ? { artwork } : {}),
                        },
                        durationMs: record.durationMs,
                        explicit: record.explicit,
                      },
                    ];
                  })
                : [],
            },
          ];
        },
      ),
    ),
  };
}

function projectGalleryItem(
  provider: ConnectorProvider,
  item: GalleryItem,
): GalleryItem {
  const itemId = stringValue(provider === "steam" ? item.appId : item.id);
  const { artwork: storedArtwork, ...publicItem } = item;
  const artwork = publicArtworkForItem(provider, itemId, storedArtwork);
  return artwork ? { ...publicItem, artwork } : publicItem;
}

function gallerySpec(
  provider: ConnectorProvider,
  library: GalleryItem[],
): GallerySpec {
  if (provider === "myanimelist") {
    const filters = countedFilters(library, (item) =>
      stringValue(item.status),
    );
    return {
      defaultSort: "recent",
      sorts: [
        { id: "recent", label: "Recently updated" },
        { id: "title", label: "Title" },
        { id: "score", label: "Score" },
        { id: "year", label: "Start year" },
      ],
      filters,
      matchesFilter: (item, filter) =>
        filter === "all" ||
        filterId(stringValue(item.status)) === filter,
      compare: (left, right, sort) =>
        sort === "title"
          ? byTitle(left, right)
          : sort === "score"
            ? descendingNumber(left.score, right.score) ||
              byTitle(left, right)
            : sort === "year"
              ? descendingNumber(left.releaseYear, right.releaseYear) ||
                byTitle(left, right)
              : descendingString(left.updatedAt, right.updatedAt) ||
                byTitle(left, right),
    };
  }

  if (provider === "hardcover") {
    const filters = countedFilters(library, (item) =>
      stringValue(item.status),
    );
    return {
      defaultSort: "recent",
      sorts: [
        { id: "recent", label: "Recently updated" },
        { id: "title", label: "Title" },
        { id: "rating", label: "Rating" },
      ],
      filters,
      matchesFilter: (item, filter) =>
        filter === "all" ||
        filterId(stringValue(item.status)) === filter,
      compare: (left, right, sort) =>
        sort === "title"
          ? byTitle(left, right)
          : sort === "rating"
            ? descendingNumber(left.rating, right.rating) ||
              byTitle(left, right)
            : descendingString(left.updatedAt, right.updatedAt) ||
              byTitle(left, right),
    };
  }

  const filters = [
    {
      id: "played",
      label: "Played",
      count: library.filter((item) => steamPlayed(item))
        .length,
    },
    {
      id: "unplayed",
      label: "Unplayed",
      count: library.filter((item) => !steamPlayed(item)).length,
    },
    {
      id: "recent",
      label: "Recent",
      count: library.filter((item) => steamRecentlyPlayed(item)).length,
    },
  ];
  return {
    defaultSort: "playtime",
    sorts: [
      { id: "playtime", label: "Playtime" },
      { id: "recent", label: "Recent playtime" },
      { id: "title", label: "Title" },
    ],
    filters,
    matchesFilter: (item, filter) =>
      filter === "all" ||
      (filter === "played" && steamPlayed(item)) ||
      (filter === "unplayed" && !steamPlayed(item)) ||
      (filter === "recent" && steamRecentlyPlayed(item)),
    compare: (left, right, sort) =>
      sort === "title"
        ? byTitle(left, right)
        : sort === "recent"
          ? descendingNumber(
              left.recentHoursRounded,
              right.recentHoursRounded,
            ) || byTitle(left, right)
          : descendingNumber(
              left.totalHoursRounded,
              right.totalHoursRounded,
            ) || byTitle(left, right),
  };
}

function countedFilters(
  library: GalleryItem[],
  labelFor: (item: GalleryItem) => string,
): GalleryFilter[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of library) {
    const label = labelFor(item);
    if (!label) continue;
    const id = filterId(label);
    const current = counts.get(id);
    counts.set(id, {
      label,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );
}

function isGalleryItem(value: unknown): value is GalleryItem {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).title === "string"
  );
}

function safeQuery(value: string | null): string {
  const normalized = value?.trim() ?? "";
  if (
    normalized.length > MAX_QUERY_LENGTH ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    return "";
  }
  return normalized;
}

function safeToken(value: string | null): string {
  const normalized = value?.trim().toLocaleLowerCase() ?? "";
  return /^[a-z0-9-]{1,64}$/.test(normalized) ? normalized : "";
}

function positiveInteger(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function filterId(value: string): string {
  return (
    value
      .toLocaleLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "other"
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function steamPlayed(item: GalleryItem): boolean {
  return typeof item.played === "boolean"
    ? item.played
    : numberValue(item.totalHoursRounded) > 0;
}

function steamRecentlyPlayed(item: GalleryItem): boolean {
  return typeof item.recentlyPlayed === "boolean"
    ? item.recentlyPlayed
    : numberValue(item.recentHoursRounded) > 0;
}

function byTitle(left: GalleryItem, right: GalleryItem): number {
  return stringValue(left.title).localeCompare(stringValue(right.title));
}

function descendingNumber(left: unknown, right: unknown): number {
  return numberValue(right) - numberValue(left);
}

function descendingString(left: unknown, right: unknown): number {
  return stringValue(right).localeCompare(stringValue(left));
}
