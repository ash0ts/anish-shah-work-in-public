import type {
  CollectionPayload,
  CollectionProvider,
  CollectionQueryState,
  ConnectorState,
  DiscogsPublicSnapshot,
  DiscogsQueryState,
  PreviewFixtureScenario,
  StravaPayload,
} from "@/components/play/connector-model";
import type { RoomConnectorObjectId } from "@/components/play/room-platform/room-types";
import type {
  SpotifyPublicSnapshot,
  SpotifyState,
} from "@/components/spotify/model";
import {
  getPublicConnectorSnapshot,
  getSpotifyPublicFallback,
} from "./connectors";
import { projectConnectorSnapshotForPublic } from "./connectors/public-gallery";
import {
  activePreviewFixtureRuntime,
  previewConnectorSnapshot,
  previewFixtureScenario,
  previewStravaSnapshot,
} from "./preview-connector-fixtures";
import {
  collectionQueryFrom,
  collectionQueryFromGallery,
  discogsQueryFrom,
  discogsQueryFromGallery,
  type PlayRouteSearchParams,
} from "./play-query";
import { getStravaPublicConfig } from "./strava-config";

export type { PlayRouteSearchParams } from "./play-query";
export { collectionQueryFrom, discogsQueryFrom } from "./play-query";

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function withPreviewFixture(
  values: PlayRouteSearchParams,
  parameters = new URLSearchParams(),
): URLSearchParams {
  const fixture = firstValue(values.fixture);
  if (fixture) parameters.set("fixture", fixture);
  return parameters;
}

export function previewFixtureForPlayRoute(
  values: PlayRouteSearchParams,
): PreviewFixtureScenario | undefined {
  if (!activePreviewFixtureRuntime()) return undefined;
  if (!firstValue(values.fixture)) return undefined;
  return previewFixtureScenario(withPreviewFixture(values));
}

function collectionSearch(query: CollectionQueryState): URLSearchParams {
  const parameters = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.query) parameters.set("q", query.query);
  if (query.filter) parameters.set("filter", query.filter);
  if (query.sort) parameters.set("sort", query.sort);
  return parameters;
}

function discogsSearch(query: DiscogsQueryState): URLSearchParams {
  const parameters = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.query) parameters.set("q", query.query);
  if (query.format) parameters.set("format", query.format);
  if (query.decade) parameters.set("decade", query.decade);
  if (query.sort) parameters.set("sort", query.sort);
  return parameters;
}

export async function getCollectionScreenFoundation(
  provider: CollectionProvider,
  values: PlayRouteSearchParams,
): Promise<{
  state: ConnectorState<CollectionPayload>;
  query: CollectionQueryState;
}> {
  const query = collectionQueryFrom(values, provider);
  const search = withPreviewFixture(values, collectionSearch(query));
  const preview = previewConnectorSnapshot(provider, search);
  const snapshot = preview ?? (await getPublicConnectorSnapshot(provider));
  if (snapshot.status !== "ready") {
    return {
      query,
      state: {
        status: "unavailable",
        message:
          "message" in snapshot
            ? snapshot.message
            : "This personal stream has not been published yet.",
      },
    };
  }

  const payload = projectConnectorSnapshotForPublic(
    provider,
    snapshot.payload,
    search,
  ) as CollectionPayload;
  const gallery = payload.gallery;

  return {
    query: gallery
      ? collectionQueryFromGallery(gallery, provider)
      : collectionQueryFrom({}, provider),
    state: {
      status: "ready",
      payload,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
    },
  };
}

export async function getDiscogsScreenFoundation(
  values: PlayRouteSearchParams,
): Promise<{
  state: ConnectorState<DiscogsPublicSnapshot>;
  query: DiscogsQueryState;
}> {
  const query = discogsQueryFrom(values);
  const search = withPreviewFixture(values, discogsSearch(query));
  const preview = previewConnectorSnapshot("discogs", search);
  const snapshot = preview ?? (await getPublicConnectorSnapshot("discogs"));
  if (snapshot.status !== "ready") {
    return {
      query,
      state: {
        status: "unavailable",
        message:
          "message" in snapshot
            ? snapshot.message
            : "This physical collection has not been published yet.",
      },
    };
  }

  const payload = projectConnectorSnapshotForPublic(
    "discogs",
    snapshot.payload,
    search,
  ) as DiscogsPublicSnapshot;

  return {
    query: discogsQueryFromGallery(payload.gallery, query.view),
    state: {
      status: "ready",
      payload,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
    },
  };
}

export async function getSpotifyScreenFoundation(
  values: PlayRouteSearchParams,
): Promise<SpotifyState> {
  const search = withPreviewFixture(values);
  const preview = previewConnectorSnapshot("spotify", search);
  const snapshot = preview ?? (await getPublicConnectorSnapshot("spotify"));
  if (snapshot.status === "ready") {
    return {
      status: "ready",
      payload: projectConnectorSnapshotForPublic(
        "spotify",
        snapshot.payload,
        search,
      ) as unknown as SpotifyPublicSnapshot,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
    };
  }

  if (preview?.status === "unavailable") {
    return {
      status: "unavailable",
      message: preview.message,
    };
  }

  const fallback = await getSpotifyPublicFallback();
  if (fallback.profileUrl || fallback.fallbackEmbed) {
    return {
      status: "fallback",
      message:
        "Spotify Top Tracks are not currently published. Official Spotify links remain available.",
      profileUrl: fallback.profileUrl,
      fallbackEmbed: fallback.fallbackEmbed,
    };
  }
  return {
    status: "unavailable",
    message: "This personal stream has not been published yet.",
  };
}

export async function getMovementScreenFoundation(
  values: PlayRouteSearchParams,
): Promise<
  ConnectorState<StravaPayload>
> {
  const preview = previewStravaSnapshot(withPreviewFixture(values));
  if (preview) {
    if (preview.status === "unavailable") {
      return { status: "unavailable", message: preview.message };
    }
    return {
      status: "ready",
      payload: preview.payload,
      fetchedAt: preview.payload.updatedAt,
      stale: false,
    };
  }
  const result = await getStravaPublicConfig();
  if (result.status !== "ready") {
    return {
      status: "unavailable",
      message: "This personal stream has not been published yet.",
    };
  }
  return {
    status: "ready",
    payload: result.config,
    fetchedAt: result.config.updatedAt,
    stale: false,
  };
}

type RoomProviderAdapter = (
  values: PlayRouteSearchParams,
) => Promise<unknown>;

/**
 * Closed provider boundary for room routes. Provider metadata is descriptive;
 * only this literal registry can invoke a server adapter.
 */
export const ROOM_PROVIDER_ADAPTERS = {
  watch: (values) => getCollectionScreenFoundation("myanimelist", values),
  read: (values) => getCollectionScreenFoundation("hardcover", values),
  listen: (values) => getSpotifyScreenFoundation(values),
  collect: (values) => getDiscogsScreenFoundation(values),
  play: (values) => getCollectionScreenFoundation("steam", values),
  move: (values) => getMovementScreenFoundation(values),
} satisfies Record<RoomConnectorObjectId, RoomProviderAdapter>;
