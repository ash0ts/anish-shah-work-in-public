import type { Metadata } from "next";

import { ClassicPlayExperience } from "@/components/play/ClassicPlayExperience";
import { streamIdFromValue } from "@/components/play/connector-model";
import { RoomOverview } from "@/components/play/room-platform/RoomOverview";
import {
  roomExperienceEnabled,
  travelAtlasEnabled,
} from "@/lib/server/play-experience";
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
  const fixtureParameter =
    typeof query.fixture === "string" ? query.fixture : undefined;
  const fixture = activePreviewFixtureRuntime() && fixtureParameter
    ? previewFixtureScenario(
        new URLSearchParams({ fixture: fixtureParameter }),
      )
    : undefined;

  if (roomExperienceEnabled()) {
    return (
      <RoomOverview
        fixture={fixture}
        travelEnabled={travelAtlasEnabled()}
      />
    );
  }

  return (
    <ClassicPlayExperience
      fixture={fixture}
      initialStream={streamIdFromValue(query.stream)}
    />
  );
}
