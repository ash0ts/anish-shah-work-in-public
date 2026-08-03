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
  if (payload.provider === "discogs") {
    return payload.snapshotVersion !== 1 || !Array.isArray(payload.library);
  }
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
  if (provider === "discogs") {
    return projectDiscogsSnapshot(payload, searchParams);
  }
  if (provider === "spotify") {
    return projectSpotifySnapshot(payload);
  }
  const rawLibrary = payload.library;
  const summary = projectCollectionSummary(provider, payload);
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

const DISCOGS_FORMATS = [
  "Box set",
  "Vinyl",
  "CD",
  "Cassette",
  "Other",
] as const;

function projectDiscogsSnapshot(
  payload: Record<string, unknown>,
  searchParams: URLSearchParams,
): Record<string, unknown> {
  const rawLibrary = Array.isArray(payload.library)
    ? payload.library.filter(isDiscogsGalleryItem)
    : [];
  const query = safeQuery(searchParams.get("q"));
  const normalizedQuery = query.toLocaleLowerCase();
  const formatOptions = countedDiscogsFilters(
    rawLibrary,
    (item) => stringValue(item.format),
  );
  const decadeOptions = countedDiscogsFilters(
    rawLibrary,
    (item) => discogsDecade(item.releaseYear),
  );
  const requestedFormat = safeToken(searchParams.get("format"));
  const requestedDecade = safeToken(searchParams.get("decade"));
  const allowedFormats = new Set(formatOptions.map((entry) => entry.id));
  const allowedDecades = new Set(decadeOptions.map((entry) => entry.id));
  const format = allowedFormats.has(requestedFormat)
    ? requestedFormat
    : "all";
  const decade = allowedDecades.has(requestedDecade)
    ? requestedDecade
    : "all";
  const requestedSort = safeToken(searchParams.get("sort"));
  const sort = ["title", "artist", "year"].includes(requestedSort)
    ? requestedSort
    : "title";
  const pageSizeCandidate = Number.parseInt(
    searchParams.get("pageSize") ?? "",
    10,
  );
  const pageSize = PAGE_SIZES.has(pageSizeCandidate)
    ? pageSizeCandidate
    : DEFAULT_PAGE_SIZE;

  const filtered = rawLibrary
    .filter((item) => {
      const title = stringValue(item.title).toLocaleLowerCase();
      const artists = Array.isArray(item.artists)
        ? item.artists.map(stringValue).join(" ").toLocaleLowerCase()
        : "";
      return (
        (!normalizedQuery ||
          title.includes(normalizedQuery) ||
          artists.includes(normalizedQuery)) &&
        (format === "all" ||
          filterId(stringValue(item.format)) === format) &&
        (decade === "all" ||
          filterId(discogsDecade(item.releaseYear)) === decade)
      );
    })
    .sort((left, right) => compareDiscogsItems(left, right, sort));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(positiveInteger(searchParams.get("page")), totalPages);
  const start = (page - 1) * pageSize;

  return {
    provider: "discogs",
    snapshotVersion: 1,
    profileUrl: payload.profileUrl,
    coverage: payload.coverage,
    totals: projectDiscogsTotals(payload.totals),
    formats: projectCountSeries(payload.formats),
    decades: projectCountSeries(payload.decades),
    formatDecadeMatrix: projectDiscogsMatrix(payload.formatDecadeMatrix),
    syncedAt: payload.syncedAt,
    freshUntil: payload.freshUntil,
    gallery: {
      ready: true,
      items: filtered
        .slice(start, start + pageSize)
        .map(projectDiscogsItem),
      page,
      pageSize,
      totalItems: filtered.length,
      libraryTotal: rawLibrary.length,
      totalPages,
      query,
      format,
      decade,
      sort,
      formats: [
        { id: "all", label: "All formats", count: rawLibrary.length },
        ...formatOptions,
      ],
      decades: [
        { id: "all", label: "All decades", count: rawLibrary.length },
        ...decadeOptions,
      ],
      sorts: [
        { id: "title", label: "Title" },
        { id: "artist", label: "Artist" },
        { id: "year", label: "Release year" },
      ],
    },
  };
}

function projectDiscogsTotals(value: unknown): Record<string, number> {
  const totals =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    physicalItems: numberValue(totals.physicalItems),
    distinctReleases: numberValue(totals.distinctReleases),
  };
}

function projectDiscogsMatrix(
  value: unknown,
): Array<{ format: string; decade: string; count: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry)
    ) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    return [{
      format: stringValue(record.format),
      decade: stringValue(record.decade),
      count: numberValue(record.count),
    }];
  });
}

function projectDiscogsItem(item: GalleryItem): GalleryItem {
  return {
    releaseId: stringValue(item.releaseId),
    title: stringValue(item.title),
    artists: Array.isArray(item.artists)
      ? item.artists.map(stringValue).filter(Boolean)
      : [],
    releaseYear: nullableNumber(item.releaseYear),
    format: stringValue(item.format),
    copyCount: numberValue(item.copyCount),
  };
}

function isDiscogsGalleryItem(value: unknown): value is GalleryItem {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.releaseId === "string" &&
    typeof item.title === "string" &&
    Array.isArray(item.artists) &&
    typeof item.format === "string"
  );
}

function countedDiscogsFilters(
  library: GalleryItem[],
  labelFor: (item: GalleryItem) => string,
): GalleryFilter[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of library) {
    const label = labelFor(item);
    const id = filterId(label);
    const current = counts.get(id);
    counts.set(id, {
      label,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((left, right) => {
      const leftIndex = DISCOGS_FORMATS.indexOf(
        left.label as (typeof DISCOGS_FORMATS)[number],
      );
      const rightIndex = DISCOGS_FORMATS.indexOf(
        right.label as (typeof DISCOGS_FORMATS)[number],
      );
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex < 0 ? 99 : leftIndex) -
          (rightIndex < 0 ? 99 : rightIndex);
      }
      if (left.label === "Undated") return 1;
      if (right.label === "Undated") return -1;
      return right.label.localeCompare(left.label);
    });
}

function discogsDecade(value: unknown): string {
  const year = nullableNumber(value);
  return year === null ? "Undated" : `${Math.floor(year / 10) * 10}s`;
}

function compareDiscogsItems(
  left: GalleryItem,
  right: GalleryItem,
  sort: string,
): number {
  if (sort === "artist") {
    const leftArtist = Array.isArray(left.artists)
      ? stringValue(left.artists[0])
      : "";
    const rightArtist = Array.isArray(right.artists)
      ? stringValue(right.artists[0])
      : "";
    return leftArtist.localeCompare(rightArtist) || byTitle(left, right);
  }
  if (sort === "year") {
    return (
      descendingNullableYear(left.releaseYear, right.releaseYear) ||
      byTitle(left, right)
    );
  }
  return byTitle(left, right);
}

function descendingNullableYear(left: unknown, right: unknown): number {
  const leftYear = nullableNumber(left);
  const rightYear = nullableNumber(right);
  if (leftYear === null && rightYear === null) return 0;
  if (leftYear === null) return 1;
  if (rightYear === null) return -1;
  return rightYear - leftYear;
}

function projectCountSeries(value: unknown): Array<{ label: string; count: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    return [{ label: stringValue(record.label), count: numberValue(record.count) }];
  });
}

function projectCollectionSummary(
  provider: Exclude<ConnectorProvider, "spotify">,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const common = {
    provider,
    snapshotVersion: 3,
    profileUrl: payload.profileUrl,
    coverage: payload.coverage,
    syncedAt: payload.syncedAt,
    freshUntil: payload.freshUntil,
  };
  if (provider === "myanimelist") {
    const recent = Array.isArray(payload.recent) ? payload.recent : [];
    return {
      ...common,
      status: projectCountSeries(payload.status),
      genres: projectCountSeries(payload.genres),
      eras: projectCountSeries(payload.eras),
      scores: projectCountSeries(payload.scores),
      recent: recent.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
        const item = entry as Record<string, unknown>;
        return [{
          id: stringValue(item.id),
          title: stringValue(item.title),
          status: stringValue(item.status),
          score: nullableNumber(item.score),
          episodesWatched: nullableNumber(item.episodesWatched),
          updatedAt: nullableString(item.updatedAt),
        }];
      }),
    };
  }
  if (provider === "hardcover") {
    const recent = Array.isArray(payload.recent) ? payload.recent : [];
    return {
      ...common,
      status: projectCountSeries(payload.status),
      ratings: projectCountSeries(payload.ratings),
      recent: recent.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
        return [projectHardcoverItem(entry as GalleryItem)];
      }),
    };
  }
  const totals =
    typeof payload.totals === "object" && payload.totals !== null
      ? (payload.totals as Record<string, unknown>)
      : {};
  const topPlayed = Array.isArray(payload.topPlayed) ? payload.topPlayed : [];
  const recent = Array.isArray(payload.recent) ? payload.recent : [];
  return {
    ...common,
    totals: {
      publicGameCount: numberValue(totals.publicGameCount),
      playedGameCount: numberValue(totals.playedGameCount),
      totalHoursRounded: numberValue(totals.totalHoursRounded),
    },
    topPlayed: topPlayed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      return [{
        appId: stringValue(item.appId),
        title: stringValue(item.title),
        hoursRounded: numberValue(item.hoursRounded),
      }];
    }),
    recent: recent.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      return [{
        appId: stringValue(item.appId),
        title: stringValue(item.title),
        recentHoursRounded: numberValue(item.recentHoursRounded),
        totalHoursRounded: numberValue(item.totalHoursRounded),
      }];
    }),
    playtime: projectCountSeries(payload.playtime),
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
  if (provider === "myanimelist") return projectMyAnimeListItem(item);
  if (provider === "hardcover") return projectHardcoverItem(item);
  if (provider === "steam") return projectSteamItem(item);
  return {};
}

function projectMyAnimeListItem(item: GalleryItem): GalleryItem {
  const id = stringValue(item.id);
  const artwork = publicArtworkForItem("myanimelist", id, item.artwork);
  return {
    id,
    title: stringValue(item.title),
    startDate: nullableString(item.startDate),
    releaseYear: nullableNumber(item.releaseYear),
    genres: Array.isArray(item.genres)
      ? item.genres.map(stringValue).filter(Boolean)
      : [],
    status: stringValue(item.status),
    score: nullableNumber(item.score),
    episodesWatched: nullableNumber(item.episodesWatched),
    updatedAt: nullableString(item.updatedAt),
    ...(artwork ? { artwork } : {}),
  };
}

function projectHardcoverItem(item: GalleryItem): GalleryItem {
  const id = stringValue(item.id);
  const artwork = publicArtworkForItem("hardcover", id, item.artwork);
  return {
    id,
    title: stringValue(item.title),
    slug: nullableString(item.slug),
    status: stringValue(item.status),
    rating: nullableNumber(item.rating),
    updatedAt: nullableString(item.updatedAt),
    ...(artwork ? { artwork } : {}),
  };
}

function projectSteamItem(item: GalleryItem): GalleryItem {
  const appId = stringValue(item.appId);
  const artwork = publicArtworkForItem("steam", appId, item.artwork);
  return {
    appId,
    title: stringValue(item.title),
    played: item.played === true,
    recentlyPlayed: item.recentlyPlayed === true,
    totalHoursRounded: numberValue(item.totalHoursRounded),
    recentHoursRounded: numberValue(item.recentHoursRounded),
    ...(artwork ? { artwork } : {}),
  };
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

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
