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

export type StreamId = "watch" | "read" | "listen" | "play" | "move";
export type CollectionProvider = "myanimelist" | "hardcover" | "steam";
export type ConnectorProvider = CollectionProvider | "strava";
export type CollectionView = "pattern" | "gallery";

export const providerTitles: Record<CollectionProvider, string> = {
  myanimelist: "Watch states, not a ranking.",
  hardcover: "A shelf in motion.",
  steam: "A public library snapshot.",
};

export function syncLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sync date unavailable";
  return `Synced ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

export function publishedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Publish date unavailable";
  return `Published ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

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
          "This stream has not been published from the owner studio yet.",
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
      message: "The last public snapshot is temporarily unavailable.",
    };
  }
}
