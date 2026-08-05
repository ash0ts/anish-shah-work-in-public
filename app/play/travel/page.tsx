import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ROOM_SCREEN_LOADERS } from "@/components/play/room-platform/room-screen-registry";
import { SITE_COPY } from "@/lib/copy";
import {
  getPublicTravelAtlas,
  parseTravelPreviewScenario,
  travelAtlasEnabled,
  travelPreviewRuntime,
} from "@/lib/server/travel";
import { hasPublicQuery, publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const query = await searchParams;
  return publicPageMetadata({
    title: SITE_COPY.play["travel-seo-title"],
    description: SITE_COPY.play["travel-seo-description"],
    path: "/play/travel",
    noindex: hasPublicQuery(query),
  });
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function TravelPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!travelAtlasEnabled()) notFound();
  const query = await searchParams;
  // Fixture selection exists only inside the exact synthetic PR-preview
  // boundary. Staging and production ignore this parameter and continue to
  // resolve their active D1/KV publication.
  const previewFixture = travelPreviewRuntime() && query.fixture !== undefined
    ? parseTravelPreviewScenario(query.fixture)
    : undefined;
  const [{ default: TravelRoomScreen }, initialState] = await Promise.all([
    ROOM_SCREEN_LOADERS.travel(),
    getPublicTravelAtlas(
        undefined,
        undefined,
        previewFixture,
      ),
  ]);
  return (
    <TravelRoomScreen
      initialState={initialState}
      previewFixture={previewFixture}
    />
  );
}
