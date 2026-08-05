import { SITE_COPY } from "@/lib/copy";

export type StatusCount = { label: string; count: number };
export type GalleryFilter = StatusCount & { id: string };
export type GallerySort = { id: string; label: string };
export type PublicArtwork = {
  src: `/api/connector-artwork/${string}/${string}`;
  aspect: "poster" | "square";
};

export type PublicGallery<Item> = {
  ready: boolean;
  items: Item[];
  page: number;
  pageSize: 12 | 24 | 36;
  totalItems: number;
  libraryTotal: number;
  totalPages: number;
  query: string;
  filter: string;
  sort: string;
  filters: GalleryFilter[];
  sorts: GallerySort[];
};

export type MalGalleryItem = {
  id: string;
  title: string;
  status: string;
  score: number | null;
  episodesWatched: number | null;
  updatedAt: string | null;
  releaseYear?: number | null;
  genres?: string[];
  artwork?: PublicArtwork;
};

export type HardcoverGalleryItem = {
  id: string;
  title: string;
  slug: string | null;
  status: string;
  rating: number | null;
  updatedAt: string | null;
  artwork?: PublicArtwork;
};

export type SteamGalleryItem = {
  appId: string;
  title: string;
  played: boolean;
  recentlyPlayed: boolean;
  totalHoursRounded: number;
  recentHoursRounded: number;
  artwork?: PublicArtwork;
};

export type MalPayload = {
  provider: "myanimelist";
  profileUrl: string | null;
  coverage: string;
  status: StatusCount[];
  genres: StatusCount[];
  eras: StatusCount[];
  scores?: StatusCount[];
  recent: MalGalleryItem[];
  gallery?: PublicGallery<MalGalleryItem>;
  syncedAt: string;
  freshUntil: string;
};

export type HardcoverPayload = {
  provider: "hardcover";
  profileUrl: string | null;
  coverage: string;
  status: StatusCount[];
  ratings?: StatusCount[];
  recent: HardcoverGalleryItem[];
  gallery?: PublicGallery<HardcoverGalleryItem>;
  syncedAt: string;
  freshUntil: string;
};

export type SteamPayload = {
  provider: "steam";
  profileUrl: string;
  coverage: string;
  totals: {
    publicGameCount: number;
    playedGameCount: number;
    totalHoursRounded: number;
  };
  topPlayed: Array<{
    appId: string;
    title: string;
    hoursRounded: number;
  }>;
  recent: SteamGalleryItem[];
  playtime?: StatusCount[];
  gallery?: PublicGallery<SteamGalleryItem>;
  syncedAt: string;
  freshUntil: string;
};

export type DiscogsFormat =
  | "Box set"
  | "Vinyl"
  | "CD"
  | "Cassette"
  | "Other";

export type DiscogsReleaseSummary = {
  releaseId: string;
  title: string;
  artists: string[];
  releaseYear: number | null;
  format: DiscogsFormat;
  copyCount: number;
};

export type DiscogsGallery = {
  ready: boolean;
  items: DiscogsReleaseSummary[];
  page: number;
  pageSize: 12 | 24 | 36;
  totalItems: number;
  libraryTotal: number;
  totalPages: number;
  query: string;
  format: string;
  decade: string;
  sort: string;
  formats: GalleryFilter[];
  decades: GalleryFilter[];
  sorts: GallerySort[];
};

export type DiscogsPublicSnapshot = {
  provider: "discogs";
  profileUrl: string;
  coverage: string;
  totals: {
    physicalItems: number;
    distinctReleases: number;
  };
  formats: Array<{ label: DiscogsFormat; count: number }>;
  decades: StatusCount[];
  formatDecadeMatrix: Array<{
    format: DiscogsFormat;
    decade: string;
    count: number;
  }>;
  gallery: DiscogsGallery;
  syncedAt: string;
  freshUntil: string;
};

export type CollectionPayload = MalPayload | HardcoverPayload | SteamPayload;
export type GalleryItem = MalGalleryItem | HardcoverGalleryItem | SteamGalleryItem;

export type StravaPayload = {
  provider: "strava";
  profileUrl: string;
  embed: {
    kind: "profile_feed" | "profile_summary" | "activity" | "route";
    embedUrl: string;
    checkedAt: string;
  } | null;
  embedStatus: "available" | "unavailable";
  updatedAt: string;
};

export type ConnectorState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; payload: T; fetchedAt: string; stale: boolean };

export type CollectionProvider = "myanimelist" | "hardcover" | "steam";
export type ConnectorProvider = CollectionProvider | "discogs" | "strava";
export type CollectionView = "pattern" | "gallery";
export type PreviewFixtureScenario =
  | "ready"
  | "unavailable"
  | "empty"
  | "stale"
  | "long-title"
  | "missing-artwork"
  | "maximum-density";

export type CollectionQueryState = {
  query: string;
  filter: string;
  sort: string;
  page: number;
  pageSize: 12 | 24 | 36;
};

export type DiscogsQueryState = {
  view: "pattern" | "gallery";
  query: string;
  format: string;
  decade: string;
  sort: string;
  page: number;
  pageSize: 12 | 24 | 36;
};

export const DEFAULT_COLLECTION_QUERY: CollectionQueryState = {
  query: "",
  filter: "",
  sort: "",
  page: 1,
  pageSize: 12,
};

export const DEFAULT_DISCOGS_QUERY: DiscogsQueryState = {
  view: "pattern",
  query: "",
  format: "",
  decade: "",
  sort: "",
  page: 1,
  pageSize: 12,
};

export const providerTitles: Record<CollectionProvider, string> = {
  myanimelist: SITE_COPY.play["watch-collection-title"],
  hardcover: SITE_COPY.play["read-collection-title"],
  steam: SITE_COPY.play["play-collection-title"],
};

export async function loadConnector<T>(
  provider: ConnectorProvider,
  parameters = new URLSearchParams(),
  signal?: AbortSignal,
): Promise<ConnectorState<T>> {
  try {
    const suffix = parameters.size ? `?${parameters.toString()}` : "";
    const response = await fetch(`/api/connectors/${provider}${suffix}`, {
      headers: { Accept: "application/json" },
      signal,
    });
    const body = (await response.json()) as {
      status: string;
      message?: string;
      payload?: T;
      fetchedAt?: string;
      stale?: boolean;
    };
    if (!response.ok || body.status !== "ready" || !body.payload) {
      return {
        status: "unavailable",
        message:
          body.message ??
          SITE_COPY.play["collection-unavailable"],
      };
    }
    return {
      status: "ready",
      payload: body.payload,
      fetchedAt: body.fetchedAt ?? "",
      stale: Boolean(body.stale),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      status: "unavailable",
      message: "This collection is temporarily unavailable.",
    };
  }
}
