import {
  getPublicConnectorSnapshot,
  type PublicSnapshotResult,
} from "../connectors/repository";
import type { ConnectorProvider } from "../connectors/types";
import {
  getStravaPublicConfig,
  type StravaConfigResult,
} from "../strava-config";
import type {
  PlayProvider,
  SimulationPlayGroundingSummary,
  SimulationSceneId,
} from "./contracts";

export const SIMULATION_PLAY_PROMPT_ITEM_LIMIT = 12;
export const SIMULATION_PLAY_PROMPT_FACET_LIMIT = 6;
export const SIMULATION_PLAY_PROMPT_CHARACTER_LIMIT = 2_400;

const TITLE_CHARACTER_LIMIT = 120;
const DESCRIPTOR_CHARACTER_LIMIT = 80;
const DESCRIPTORS_PER_ITEM = 3;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/g;
const REMOTE_URL = /\bhttps?:\/\/[^\s]+/gi;
const EMAIL_ADDRESS = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gi;

type CollectionItem = {
  title: string;
  descriptors: string[];
};

type CollectionProjection = {
  items: CollectionItem[];
  facets: string[];
};

type SnapshotLoader = (
  provider: ConnectorProvider,
) => Promise<PublicSnapshotResult>;

type StravaLoader = (
  database?: D1Database | null,
) => Promise<StravaConfigResult>;

export type SimulationPlayGroundingLoaders = {
  connectorSnapshot: SnapshotLoader;
  stravaConfig: StravaLoader;
};

export type ResolveSimulationPlayGroundingInput = {
  sceneId: Exclude<SimulationSceneId, "complete">;
  provider: PlayProvider;
  approvedForGameAndModel: boolean;
  database?: D1Database | null;
  now?: Date;
  loaders?: SimulationPlayGroundingLoaders;
};

const defaultLoaders: SimulationPlayGroundingLoaders = {
  connectorSnapshot: getPublicConnectorSnapshot,
  stravaConfig: getStravaPublicConfig,
};

function plainText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(CONTROL_CHARACTER, " ")
    .replace(REMOTE_URL, " ")
    .replace(EMAIL_ADDRESS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, maximum).join("");
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniquePlainStrings(
  values: readonly unknown[],
  maximum: number,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = plainText(value, maximum);
    const key = text?.toLocaleLowerCase("en-US");
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function categoricalSeries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      const record = objectRecord(entry);
      const label = plainText(record?.label, DESCRIPTOR_CHARACTER_LIMIT);
      const count = record?.count;
      return label && typeof count === "number" && Number.isFinite(count)
        ? [{ label, count }]
        : [];
    })
    .sort(
      (left, right) =>
        right.count - left.count || compareText(left.label, right.label),
    )
    .map(({ label }) => label);
}

function compareText(left: string, right: string): number {
  const a = left.toLocaleLowerCase("en-US");
  const b = right.toLocaleLowerCase("en-US");
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
}

function collectionItem(
  title: unknown,
  descriptors: readonly unknown[],
): CollectionItem | null {
  const safeTitle = plainText(title, TITLE_CHARACTER_LIMIT);
  if (!safeTitle) return null;
  return {
    title: safeTitle,
    descriptors: uniquePlainStrings(
      descriptors,
      DESCRIPTOR_CHARACTER_LIMIT,
    ).slice(0, DESCRIPTORS_PER_ITEM),
  };
}

function libraryRecords(payload: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(payload.library)
    ? payload.library.flatMap((value) => {
        const record = objectRecord(value);
        return record ? [record] : [];
      })
    : [];
}

function myAnimeListProjection(
  payload: Record<string, unknown>,
): CollectionProjection {
  const items = libraryRecords(payload).flatMap((item) => {
    const genres = Array.isArray(item.genres) ? item.genres.slice(0, 2) : [];
    const projected = collectionItem(item.title, [item.status, ...genres]);
    return projected ? [projected] : [];
  });
  return {
    items,
    facets: [
      ...categoricalSeries(payload.status),
      ...categoricalSeries(payload.genres),
      ...categoricalSeries(payload.eras),
    ],
  };
}

function hardcoverProjection(
  payload: Record<string, unknown>,
): CollectionProjection {
  const items = libraryRecords(payload).flatMap((item) => {
    const projected = collectionItem(item.title, [item.status]);
    return projected ? [projected] : [];
  });
  return {
    items,
    facets: categoricalSeries(payload.status),
  };
}

function spotifyProjection(
  payload: Record<string, unknown>,
): CollectionProjection {
  const windows = objectRecord(payload.windows);
  const names: Array<[string, string]> = [
    ["short_term", "Recent affinity"],
    ["medium_term", "Six-month affinity"],
    ["long_term", "Long-term affinity"],
  ];
  const items: CollectionItem[] = [];
  const facets: string[] = [];
  for (const [key, label] of names) {
    const window = objectRecord(windows?.[key]);
    if (!Array.isArray(window?.tracks)) continue;
    facets.push(label);
    for (const rawTrack of window.tracks) {
      const track = objectRecord(rawTrack);
      const album = objectRecord(track?.album);
      const artists = Array.isArray(track?.artists)
        ? track.artists.flatMap((value) => {
            const artist = objectRecord(value);
            return artist?.name ? [artist.name] : [];
          })
        : [];
      const projected = collectionItem(track?.title, [
        ...artists.slice(0, 2),
        album?.title,
        label,
      ]);
      if (projected) items.push(projected);
    }
  }
  return { items, facets };
}

function discogsProjection(
  payload: Record<string, unknown>,
): CollectionProjection {
  const items = libraryRecords(payload).flatMap((release) => {
    const artists = Array.isArray(release.artists)
      ? release.artists.slice(0, 2)
      : [];
    const projected = collectionItem(release.title, [
      ...artists,
      release.format,
      typeof release.releaseYear === "number"
        ? String(release.releaseYear)
        : null,
    ]);
    return projected ? [projected] : [];
  });
  return {
    items,
    facets: [
      ...categoricalSeries(payload.formats),
      ...categoricalSeries(payload.decades),
    ],
  };
}

function steamProjection(payload: Record<string, unknown>): CollectionProjection {
  const items = libraryRecords(payload).flatMap((game) => {
    const projected = collectionItem(game.title, [
      game.recentlyPlayed === true
        ? "Recently played"
        : game.played === true
          ? "Played"
          : "Unplayed",
    ]);
    return projected ? [projected] : [];
  });
  return {
    items,
    facets: categoricalSeries(payload.playtime),
  };
}

function collectionProjection(
  provider: Exclude<PlayProvider, "strava">,
  payload: Record<string, unknown>,
): CollectionProjection {
  switch (provider) {
    case "myanimelist":
      return myAnimeListProjection(payload);
    case "hardcover":
      return hardcoverProjection(payload);
    case "spotify":
      return spotifyProjection(payload);
    case "discogs":
      return discogsProjection(payload);
    case "steam":
      return steamProjection(payload);
  }
}

function deduplicatedSortedItems(items: CollectionItem[]): CollectionItem[] {
  const byKey = new Map<string, CollectionItem>();
  for (const item of items) {
    const key = `${item.title.toLocaleLowerCase("en-US")}\u0000${item.descriptors
      .join("\u0000")
      .toLocaleLowerCase("en-US")}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      compareText(left.title, right.title) ||
      compareText(left.descriptors.join(" "), right.descriptors.join(" ")),
  );
}

function sampleAcrossCollection(
  items: CollectionItem[],
  maximum: number,
): CollectionItem[] {
  if (items.length <= maximum) return items;
  if (maximum === 1) return [items[0]];
  const indices = Array.from({ length: maximum }, (_, index) =>
    Math.round((index * (items.length - 1)) / (maximum - 1)),
  );
  return [...new Set(indices)].map((index) => items[index]);
}

function boundedSummary(
  provider: Exclude<PlayProvider, "strava">,
  projection: CollectionProjection,
): SimulationPlayGroundingSummary | null {
  const facets = uniquePlainStrings(
    projection.facets,
    DESCRIPTOR_CHARACTER_LIMIT,
  ).slice(0, SIMULATION_PLAY_PROMPT_FACET_LIMIT);
  const candidates = sampleAcrossCollection(
    deduplicatedSortedItems(projection.items),
    SIMULATION_PLAY_PROMPT_ITEM_LIMIT,
  );
  if (!candidates.length) return null;

  const accepted: CollectionItem[] = [];
  for (const item of candidates) {
    const candidate: SimulationPlayGroundingSummary = {
      provider,
      source: "current_public_snapshot",
      facets,
      items: [...accepted, item],
    };
    if (
      JSON.stringify(candidate).length >
      SIMULATION_PLAY_PROMPT_CHARACTER_LIMIT
    ) {
      break;
    }
    accepted.push(item);
  }
  return accepted.length
    ? {
        provider,
        source: "current_public_snapshot",
        facets,
        items: accepted,
      }
    : null;
}

function canonicalFuture(value: unknown, now: Date): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString() === value &&
    parsed.getTime() > now.getTime()
  );
}

async function connectorSummary(
  provider: Exclude<PlayProvider, "strava">,
  now: Date,
  loaders: SimulationPlayGroundingLoaders,
): Promise<SimulationPlayGroundingSummary | null> {
  const snapshot = await loaders.connectorSnapshot(provider);
  if (
    snapshot.status !== "ready" ||
    snapshot.provider !== provider ||
    snapshot.stale ||
    !canonicalFuture(snapshot.freshUntil, now) ||
    snapshot.payload.provider !== provider
  ) {
    return null;
  }
  return boundedSummary(provider, collectionProjection(provider, snapshot.payload));
}

async function stravaSummary(
  database: D1Database | null | undefined,
  loaders: SimulationPlayGroundingLoaders,
): Promise<SimulationPlayGroundingSummary | null> {
  const result = await loaders.stravaConfig(database);
  if (
    result.status !== "ready" ||
    result.config.provider !== "strava" ||
    result.config.embedStatus !== "available" ||
    !result.config.embed
  ) {
    return null;
  }
  const labelByKind = {
    profile_feed: "Recent public activity feed",
    profile_summary: "Public activity summary",
    activity: "Public activity highlight",
    route: "Public route highlight",
  } as const;
  return {
    provider: "strava",
    source: "current_public_config",
    facets: [labelByKind[result.config.embed.kind]],
    items: [],
  };
}

/**
 * Resolves one Act III doorway into a bounded model-facing summary. Approval,
 * scene, publication, and freshness failures all return null without exposing
 * why; callers then use the authored generic doorway.
 */
export async function resolveSimulationPlayGrounding(
  input: ResolveSimulationPlayGroundingInput,
): Promise<SimulationPlayGroundingSummary | null> {
  if (input.sceneId !== "act-3" || !input.approvedForGameAndModel) return null;
  const loaders = input.loaders ?? defaultLoaders;
  try {
    return input.provider === "strava"
      ? await stravaSummary(input.database, loaders)
      : await connectorSummary(
          input.provider,
          input.now ?? new Date(),
          loaders,
        );
  } catch {
    return null;
  }
}
