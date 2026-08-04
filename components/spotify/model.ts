export type SpotifyTimeRange = "short_term" | "medium_term" | "long_term";

export type PublicArtwork = {
  src: `/api/connector-artwork/${string}/${string}`;
  aspect: "poster" | "square";
};

export type SpotifyTrackSummary = {
  id: string;
  position: number;
  title: string;
  artists: Array<{ id: string; name: string }>;
  album: {
    id: string;
    title: string;
    releaseYear: number | null;
    artwork: PublicArtwork | null;
  };
  durationMs: number;
  explicit: boolean;
};

export type SpotifyEmbedReference = {
  kind: "track" | "album" | "playlist";
  spotifyId: string;
};

export type SpotifyPublicSnapshot = {
  provider: "spotify";
  profileUrl: string;
  coverage: "Spotify-calculated affinity; not play counts" | string;
  windows: Record<
    SpotifyTimeRange,
    {
      tracks: SpotifyTrackSummary[];
    }
  >;
  syncedAt: string;
  freshUntil: string;
};

export type SpotifyState =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | {
      status: "fallback";
      message: string;
      profileUrl: string | null;
      fallbackEmbed: SpotifyEmbedReference | null;
    }
  | {
      status: "ready";
      payload: SpotifyPublicSnapshot;
      fetchedAt: string;
      stale: boolean;
    };

export type SpotifyView = "groove" | "covers";
export type RankSurface = "groove" | "rail";

export const timeRanges: ReadonlyArray<{
  id: SpotifyTimeRange;
  label: string;
  shortLabel: string;
}> = [
  { id: "short_term", label: "Last approximately 4 weeks", shortLabel: "~4 weeks" },
  { id: "medium_term", label: "Last approximately 6 months", shortLabel: "~6 months" },
  { id: "long_term", label: "About 1 year", shortLabel: "~1 year" },
];

export const grooveCenter = 210;
export const grooveRadius = 154;

async function loadSpotifyUrl(
  url: string,
  signal: AbortSignal,
): Promise<SpotifyState> {
  try {
    const request = { headers: { Accept: "application/json" }, signal };
    const response =
      url === "/api/connectors/spotify"
        ? await fetch("/api/connectors/spotify", request)
        : await fetch(url, request);
    const body = (await response.json()) as {
      status?: string;
      message?: string;
      payload?: SpotifyPublicSnapshot;
      fetchedAt?: string;
      stale?: boolean;
      profileUrl?: string | null;
      fallbackEmbed?: SpotifyEmbedReference | null;
    };

    if (response.ok && body.status === "ready" && body.payload) {
      return {
        status: "ready",
        payload: body.payload,
        fetchedAt: body.fetchedAt ?? "",
        stale: Boolean(body.stale),
      };
    }

    if (response.ok && body.status === "fallback") {
      return {
        status: "fallback",
        message:
          body.message ??
          "Top Tracks are not published, so only the owner-selected Spotify reference is available.",
        profileUrl: body.profileUrl ?? null,
        fallbackEmbed: body.fallbackEmbed ?? null,
      };
    }

    return {
      status: "unavailable",
      message:
        body.message ??
        "This Spotify stream has not been published from the owner studio yet.",
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      status: "unavailable",
      message: "Spotify is temporarily unavailable.",
    };
  }
}

export function loadSpotify(signal: AbortSignal): Promise<SpotifyState> {
  return loadSpotifyUrl("/api/connectors/spotify", signal);
}

export function loadSpotifyFixture(
  signal: AbortSignal,
  fixture: PreviewFixtureScenario,
): Promise<SpotifyState> {
  return loadSpotifyUrl(
    `/api/connectors/spotify?fixture=${encodeURIComponent(fixture)}`,
    signal,
  );
}

export function groovePoint(index: number, total: number) {
  const angle = total ? (index / total) * Math.PI * 2 : 0;
  return {
    x: grooveCenter + Math.sin(angle) * grooveRadius,
    y: grooveCenter - Math.cos(angle) * grooveRadius,
  };
}

export function artistLabel(track: SpotifyTrackSummary) {
  return track.artists.map((artist) => artist.name).join(", ");
}

export function durationLabel(durationMs: number) {
  const totalSeconds = Math.max(Math.round(durationMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function spotifyTrackUrl(id: string) {
  return `https://open.spotify.com/track/${encodeURIComponent(id)}`;
}

export function spotifyEmbedUrl(
  kind: SpotifyEmbedReference["kind"],
  id: string,
) {
  return `https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}`;
}

import type { PreviewFixtureScenario } from "../play/connector-model";
