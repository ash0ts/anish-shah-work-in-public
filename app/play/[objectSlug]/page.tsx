import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound, redirect } from "next/navigation";
import {
  ROOM_OBJECTS,
  roomObject,
} from "@/components/play/room-platform/room-registry";
import { ROOM_SCREEN_LOADERS } from "@/components/play/room-platform/room-screen-registry";
import type { RoomObjectId } from "@/components/play/room-platform/room-types";
import {
  roomExperienceEnabled,
  travelAtlasEnabled,
} from "@/lib/server/play-experience";
import {
  ROOM_PROVIDER_ADAPTERS,
  previewFixtureForPlayRoute,
  type PlayRouteSearchParams,
} from "@/lib/server/play-screen-foundation";
import { hasPublicQuery, publicPageMetadata } from "@/lib/seo";
import { getPublicTravelAtlas } from "@/lib/server/travel";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ objectSlug: string }>;
  searchParams: Promise<PlayRouteSearchParams>;
};

type RoomRouteFoundation = (
  query: PlayRouteSearchParams,
) => Promise<ReactElement>;

/**
 * Dispatch occurs only after roomObject() validates the slug. Each branch pairs
 * one literal screen loader with one literal provider adapter.
 */
export const ROOM_ROUTE_FOUNDATIONS = {
  watch: async (query) => {
    const [{ default: WatchRoomScreen }, foundation] = await Promise.all([
      ROOM_SCREEN_LOADERS.watch(),
      ROOM_PROVIDER_ADAPTERS.watch(query),
    ]);
    return (
      <WatchRoomScreen
        fixture={previewFixtureForPlayRoute(query)}
        initialQuery={foundation.query}
        initialState={foundation.state}
      />
    );
  },
  read: async (query) => {
    const [{ default: ReadRoomScreen }, foundation] = await Promise.all([
      ROOM_SCREEN_LOADERS.read(),
      ROOM_PROVIDER_ADAPTERS.read(query),
    ]);
    return (
      <ReadRoomScreen
        fixture={previewFixtureForPlayRoute(query)}
        initialQuery={foundation.query}
        initialState={foundation.state}
      />
    );
  },
  listen: async (query) => {
    const [{ default: ListenRoomScreen }, initialState] = await Promise.all([
      ROOM_SCREEN_LOADERS.listen(),
      ROOM_PROVIDER_ADAPTERS.listen(query),
    ]);
    return (
      <ListenRoomScreen
        fixture={previewFixtureForPlayRoute(query)}
        initialState={initialState}
      />
    );
  },
  collect: async (query) => {
    const [{ default: CollectRoomScreen }, foundation] = await Promise.all([
      ROOM_SCREEN_LOADERS.collect(),
      ROOM_PROVIDER_ADAPTERS.collect(query),
    ]);
    return (
      <CollectRoomScreen
        fixture={previewFixtureForPlayRoute(query)}
        initialQuery={foundation.query}
        initialState={foundation.state}
      />
    );
  },
  play: async (query) => {
    const [{ default: PlayRoomScreen }, foundation] = await Promise.all([
      ROOM_SCREEN_LOADERS.play(),
      ROOM_PROVIDER_ADAPTERS.play(query),
    ]);
    return (
      <PlayRoomScreen
        fixture={previewFixtureForPlayRoute(query)}
        initialQuery={foundation.query}
        initialState={foundation.state}
      />
    );
  },
  move: async (query) => {
    const [{ default: MoveRoomScreen }, initialState] = await Promise.all([
      ROOM_SCREEN_LOADERS.move(),
      ROOM_PROVIDER_ADAPTERS.move(query),
    ]);
    return (
      <MoveRoomScreen
        fixture={previewFixtureForPlayRoute(query)}
        initialState={initialState}
      />
    );
  },
  travel: async () => {
    if (!travelAtlasEnabled()) notFound();
    const [{ default: TravelRoomScreen }, initialState] = await Promise.all([
      ROOM_SCREEN_LOADERS.travel(),
      getPublicTravelAtlas(),
    ]);
    return <TravelRoomScreen initialState={initialState} />;
  },
} satisfies Record<RoomObjectId, RoomRouteFoundation>;

export function generateStaticParams() {
  return ROOM_OBJECTS.map((object) => ({ objectSlug: object.slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const [{ objectSlug }, query] = await Promise.all([params, searchParams]);
  const object = roomObject(objectSlug);
  if (!object) {
    return publicPageMetadata({
      title: "Collection not found",
      description:
        "That object isn’t in My Room, 2001. Return to Play and choose one from the room.",
      path: "/play",
      noindex: true,
    });
  }
  if (object.contentSource.kind === "travel-log" && !travelAtlasEnabled()) {
    return publicPageMetadata({
      title: "Travel atlas not found",
      description: "This travel atlas is not currently public.",
      path: "/play",
      noindex: true,
    });
  }
  return publicPageMetadata({
    title: `${object.label} · ${object.title}`,
    description: `${object.description} Open the ${object.object.toLowerCase()} to explore the collection.`,
    path: object.route,
    noindex: hasPublicQuery(query),
  });
}

export default async function PlayObjectPage({
  params,
  searchParams,
}: PageProps) {
  const [{ objectSlug }, query] = await Promise.all([params, searchParams]);
  const object = roomObject(objectSlug);
  if (!object) notFound();
  if (!roomExperienceEnabled()) redirect("/play");
  if (object.contentSource.kind === "travel-log" && !travelAtlasEnabled()) {
    notFound();
  }
  return ROOM_ROUTE_FOUNDATIONS[object.id](query);
}
