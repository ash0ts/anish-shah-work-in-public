import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { RoomOverview } from "@/components/play/room-platform/RoomOverview";
import { roomObjectContract } from "@/components/play/room-platform/room-object-contract";
import { travelAtlasEnabled } from "@/lib/server/travel";
import {
  activePreviewFixtureRuntime,
  previewFixtureScenario,
} from "@/lib/server/preview-connector-fixtures";
import { hasPublicQuery, publicPageMetadata } from "@/lib/seo";
import { SITE_COPY } from "@/lib/copy";

export const dynamic = "force-dynamic";

const playDescription = SITE_COPY.play["seo-description"];

type PlaySearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<PlaySearchParams>;
}): Promise<Metadata> {
  const query = await searchParams;
  return publicPageMetadata({
    title: SITE_COPY.play["seo-title"],
    description: playDescription,
    path: "/play",
    noindex: hasPublicQuery(query),
  });
}

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<PlaySearchParams>;
}) {
  const query = await searchParams;
  const legacyStream = Array.isArray(query.stream)
    ? query.stream[0]
    : query.stream;
  const legacyObject = roomObjectContract(legacyStream);
  if (
    legacyObject?.contentSource.kind === "connector" &&
    legacyStream === legacyObject.id
  ) {
    permanentRedirect(legacyObject.route);
  }
  const fixtureParameter =
    typeof query.fixture === "string" ? query.fixture : undefined;
  const fixture = activePreviewFixtureRuntime() && fixtureParameter
    ? previewFixtureScenario(
        new URLSearchParams({ fixture: fixtureParameter }),
      )
    : undefined;

  return (
    <RoomOverview
      fixture={fixture}
      travelEnabled={travelAtlasEnabled()}
    />
  );
}
