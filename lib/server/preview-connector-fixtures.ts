import { previewFixtureRuntime } from "../deployment-environment";
import { runtimeValue } from "./runtime-env";
import type { ConnectorProvider } from "./connectors/types";

const SYNCED_AT = "2026-01-15T12:00:00.000Z";
const FRESH_UNTIL = "2026-01-16T00:00:00.000Z";
const FIXTURE_SCENARIOS = new Set([
  "ready",
  "unavailable",
  "empty",
  "stale",
  "long-title",
  "missing-artwork",
  "maximum-density",
]);

export type PreviewFixtureScenario =
  | "ready"
  | "unavailable"
  | "empty"
  | "stale"
  | "long-title"
  | "missing-artwork"
  | "maximum-density";

export function activePreviewFixtureRuntime(): boolean {
  return previewFixtureRuntime({
    DEPLOYMENT_TIER: runtimeValue("DEPLOYMENT_TIER"),
    PREVIEW_PR_NUMBER: runtimeValue("PREVIEW_PR_NUMBER"),
    SITE_URL: runtimeValue("SITE_URL"),
    PRODUCTION_SITE_URL: runtimeValue("PRODUCTION_SITE_URL"),
    PUBLIC_CONTENT_MODE: runtimeValue("PUBLIC_CONTENT_MODE"),
  });
}

export function previewFixtureScenario(
  searchParams: URLSearchParams,
): PreviewFixtureScenario {
  const candidate = searchParams.get("fixture") ?? "ready";
  return FIXTURE_SCENARIOS.has(candidate)
    ? (candidate as PreviewFixtureScenario)
    : "ready";
}

function title(
  base: string,
  index: number,
  scenario: PreviewFixtureScenario,
): string {
  if (scenario !== "long-title" || index !== 0) return `${base} ${index + 1}`;
  return `${base}: A deliberately long multilingual collection title for responsive preview validation — 記憶と機械のあいだ`;
}

function fixtureCount(scenario: PreviewFixtureScenario): number {
  if (scenario === "empty") return 0;
  return scenario === "maximum-density" ? 36 : 14;
}

function collectionPayload(
  provider: Exclude<ConnectorProvider, "spotify">,
  scenario: PreviewFixtureScenario,
): Record<string, unknown> {
  const count = fixtureCount(scenario);
  const coverage = "Synthetic preview data · never sourced from an owner account";
  if (provider === "myanimelist") {
    const library = Array.from({ length: count }, (_, index) => ({
      id: String(800_000 + index),
      title: title("Signal Archive", index, scenario),
      startDate: `${2001 + (index % 20)}-01-01`,
      releaseYear: 2001 + (index % 20),
      genres: index % 2 ? ["Drama", "Science Fiction"] : ["Adventure"],
      status: index % 3 === 0 ? "watching" : "completed",
      score: 7 + (index % 4),
      episodesWatched: 12 + index,
      updatedAt: SYNCED_AT,
      ...(scenario === "missing-artwork"
        ? {}
        : {
            artwork: {
              kind: "mal-cover",
              assetKey: `/images/anime/1/${800_000 + index}.jpg`,
            },
          }),
    }));
    return {
      provider,
      snapshotVersion: 3,
      profileUrl: "https://myanimelist.net/",
      coverage,
      status: [
        { label: "Completed", count: library.filter((item) => item.status === "completed").length },
        { label: "Watching", count: library.filter((item) => item.status === "watching").length },
      ],
      genres: [{ label: "Science Fiction", count: Math.ceil(count / 2) }],
      eras: [{ label: "2000s", count: count }],
      scores: [{ label: "8", count: Math.ceil(count / 3) }],
      recent: library.slice(0, 8),
      library,
      syncedAt: SYNCED_AT,
      freshUntil: FRESH_UNTIL,
    };
  }
  if (provider === "hardcover") {
    const library = Array.from({ length: count }, (_, index) => ({
      id: String(900_000 + index),
      title: title("Machines and Meaning", index, scenario),
      slug: `preview-book-${index + 1}`,
      status: index % 4 === 0 ? "currently-reading" : "read",
      rating: 3 + (index % 3),
      updatedAt: SYNCED_AT,
      ...(scenario === "missing-artwork"
        ? {}
        : {
            artwork: {
              kind: "hardcover-cover",
              assetKey: `/images/books/${900_000 + index}.jpg`,
            },
          }),
    }));
    return {
      provider,
      snapshotVersion: 3,
      profileUrl: "https://hardcover.app/",
      coverage,
      status: [{ label: "Read", count }],
      ratings: [{ label: "4 stars", count: Math.ceil(count / 3) }],
      recent: library.slice(0, 8),
      library,
      syncedAt: SYNCED_AT,
      freshUntil: FRESH_UNTIL,
    };
  }
  if (provider === "discogs") {
    const formatOrder = ["Box set", "Vinyl", "CD", "Cassette", "Other"];
    const library = Array.from({ length: count }, (_, index) => ({
      releaseId: String(700_000 + index),
      title: title("Physical Signal", index, scenario),
      artists: [`Synthetic Artist ${(index % 7) + 1}`],
      releaseYear: index % 9 === 0 ? null : 1968 + (index * 4) % 56,
      format: formatOrder[index % formatOrder.length],
      copyCount: index % 11 === 0 ? 2 : 1,
    }));
    const formats = new Map(formatOrder.map((format) => [format, 0]));
    const decades = new Map<string, number>();
    const matrix = new Map<string, number>();
    for (const release of library) {
      const decade = release.releaseYear === null
        ? "Undated"
        : `${Math.floor(release.releaseYear / 10) * 10}s`;
      formats.set(
        release.format,
        (formats.get(release.format) ?? 0) + release.copyCount,
      );
      decades.set(decade, (decades.get(decade) ?? 0) + release.copyCount);
      const key = `${release.format}\u0000${decade}`;
      matrix.set(key, (matrix.get(key) ?? 0) + release.copyCount);
    }
    return {
      provider,
      snapshotVersion: 1,
      profileUrl: "https://www.discogs.com/user/preview/collection",
      coverage: "Physical releases returned from the public Discogs collection",
      totals: {
        physicalItems: library.reduce(
          (sum, release) => sum + release.copyCount,
          0,
        ),
        distinctReleases: library.length,
      },
      formats: [...formats].map(([label, value]) => ({ label, count: value })),
      decades: [...decades].map(([label, value]) => ({ label, count: value })),
      formatDecadeMatrix: [...matrix].map(([key, value]) => {
        const [format, decade] = key.split("\u0000");
        return { format, decade, count: value };
      }),
      library,
      syncedAt: SYNCED_AT,
      freshUntil: FRESH_UNTIL,
    };
  }
  const library = Array.from({ length: count }, (_, index) => ({
    appId: String(900_000 + index),
    title: title("Archive Protocol", index, scenario),
    played: index % 3 !== 0,
    recentlyPlayed: index < 6,
    totalHoursRounded: (index + 1) * 5,
    recentHoursRounded: index < 6 ? index + 1 : 0,
    ...(scenario === "missing-artwork"
      ? {}
      : {
          artwork: {
            kind: "steam-icon",
            appId: String(900_000 + index),
            hash: index.toString(16).padStart(40, "0"),
          },
        }),
  }));
  return {
    provider,
    snapshotVersion: 3,
    profileUrl: "https://steamcommunity.com/",
    coverage,
    totals: {
      publicGameCount: count,
      playedGameCount: library.filter((item) => item.played).length,
      totalHoursRounded: library.reduce((sum, item) => sum + item.totalHoursRounded, 0),
    },
    topPlayed: library.slice(0, 8).map((item) => ({
      appId: item.appId,
      title: item.title,
      hoursRounded: item.totalHoursRounded,
    })),
    recent: library.slice(0, 8),
    playtime: [{ label: "Played", count: library.filter((item) => item.played).length }],
    library,
    syncedAt: SYNCED_AT,
    freshUntil: FRESH_UNTIL,
  };
}

function spotifyPayload(
  scenario: PreviewFixtureScenario,
): Record<string, unknown> {
  const count = Math.min(12, fixtureCount(scenario));
  const tracks = Array.from({ length: count }, (_, index) => ({
    id: `PREVIEWTRACK${String(index + 1).padStart(10, "0")}`.slice(0, 22),
    position: index + 1,
    title: title("Night Drive", index, scenario),
    artists: [{ id: `PREVIEWARTIST${String(index + 1).padStart(9, "0")}`.slice(0, 22), name: `Synthetic Artist ${index + 1}` }],
    album: {
      id: `PREVIEWALBUM${String(index + 1).padStart(10, "0")}`.slice(0, 22),
      title: `Preview Album ${index + 1}`,
      releaseYear: 1998 + (index % 20),
      artwork: null,
      ...(scenario === "missing-artwork"
        ? {}
        : {
            artwork: {
              kind: "spotify-cover",
              assetKey: `/image/${`PREVIEW${String(index + 1).padStart(20, "0")}`}`,
            },
          }),
    },
    durationMs: 180_000 + index * 1_000,
    explicit: index % 5 === 0,
  }));
  return {
    provider: "spotify",
    snapshotVersion: 1,
    profileUrl: "https://open.spotify.com/",
    coverage: "Synthetic preview ranking · not listening history or play counts",
    windows: Object.fromEntries(
      ["short_term", "medium_term", "long_term"].map((range) => [range, { tracks }]),
    ),
    syncedAt: SYNCED_AT,
    freshUntil: FRESH_UNTIL,
  };
}

export function previewConnectorSnapshot(
  provider: ConnectorProvider,
  searchParams: URLSearchParams,
):
  | { status: "unavailable"; provider: ConnectorProvider; message: string }
  | {
      status: "ready";
      provider: ConnectorProvider;
      payload: Record<string, unknown>;
      fetchedAt: string;
      stale: boolean;
    }
  | null {
  if (!activePreviewFixtureRuntime()) return null;
  const scenario = previewFixtureScenario(searchParams);
  if (scenario === "unavailable") {
    return {
      status: "unavailable",
      provider,
      message: "Synthetic unavailable state for visual preview review.",
    };
  }
  return {
    status: "ready",
    provider,
    payload:
      provider === "spotify"
        ? spotifyPayload(scenario)
        : collectionPayload(provider, scenario),
    fetchedAt: SYNCED_AT,
    stale: scenario === "stale",
  };
}

export function previewStravaSnapshot(
  searchParams: URLSearchParams,
): Record<string, unknown> | null {
  if (!activePreviewFixtureRuntime()) return null;
  const scenario = previewFixtureScenario(searchParams);
  if (scenario === "unavailable") {
    return {
      status: "unavailable",
      provider: "strava",
      code: "preview_fixture",
      message: "Synthetic unavailable state for visual preview review.",
    };
  }
  return {
    status: "ready",
    provider: "strava",
    payload: {
      provider: "strava",
      profileUrl: "https://www.strava.com/",
      embed: null,
      embedStatus: "unavailable",
      updatedAt: SYNCED_AT,
      previewNotice: "Synthetic preview data",
    },
  };
}
