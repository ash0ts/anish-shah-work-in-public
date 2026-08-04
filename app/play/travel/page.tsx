import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TravelRoomScreen from "@/components/play/room-screens/TravelRoomScreen";
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
    title: "Travel · Postcard Planet",
    description:
      "Explore Anish Shah’s public trips, approximate places, and photographs through an interactive world atlas.",
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
  return (
    <TravelRoomScreen
      initialState={await getPublicTravelAtlas(
        undefined,
        undefined,
        previewFixture,
      )}
      previewFixture={previewFixture}
    />
  );
}
