import type {
  CollectionPayload,
  CollectionProvider,
  CollectionQueryState,
  ConnectorState,
  DiscogsPublicSnapshot,
  DiscogsQueryState,
  StravaPayload,
} from "@/components/play/connector-model";
import type { RoomObjectId } from "@/components/play/room-platform/room-types";
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
  collectionQueryFrom,
  collectionQueryFromGallery,
  discogsQueryFrom,
  discogsQueryFromGallery,
  type PlayRouteSearchParams,
} from "./play-query";
import { getStravaPublicConfig } from "./strava-config";

export type { PlayRouteSearchParams } from "./play-query";
export { collectionQueryFrom, discogsQueryFrom } from "./play-query";

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
  const snapshot = await getPublicConnectorSnapshot(provider);
  if (snapshot.status !== "ready") {
    return {
      query,
      state: {
        status: "unavailable",
        message: "This personal stream has not been published yet.",
      },
    };
  }

  const payload = projectConnectorSnapshotForPublic(
    provider,
    snapshot.payload,
    collectionSearch(query),
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
  const snapshot = await getPublicConnectorSnapshot("discogs");
  if (snapshot.status !== "ready") {
    return {
      query,
      state: {
        status: "unavailable",
        message: "This physical collection has not been published yet.",
      },
    };
  }

  const payload = projectConnectorSnapshotForPublic(
    "discogs",
    snapshot.payload,
    discogsSearch(query),
  ) as DiscogsPublicSnapshot;

  return {
    query: discogsQueryFromGallery(payload.gallery),
    state: {
      status: "ready",
      payload,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
    },
  };
}

export async function getSpotifyScreenFoundation(): Promise<SpotifyState> {
  const snapshot = await getPublicConnectorSnapshot("spotify");
  if (snapshot.status === "ready") {
    return {
      status: "ready",
      payload: projectConnectorSnapshotForPublic(
        "spotify",
        snapshot.payload,
        new URLSearchParams(),
      ) as unknown as SpotifyPublicSnapshot,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
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

export async function getMovementScreenFoundation(): Promise<
  ConnectorState<StravaPayload>
> {
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
  listen: (values) => {
    void values;
    return getSpotifyScreenFoundation();
  },
  collect: (values) => getDiscogsScreenFoundation(values),
  play: (values) => getCollectionScreenFoundation("steam", values),
  move: (values) => {
    void values;
    return getMovementScreenFoundation();
  },
} satisfies Record<RoomObjectId, RoomProviderAdapter>;
