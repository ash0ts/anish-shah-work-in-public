import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TravelTripLog } from "@/components/play/travel/TravelTripLog";
import {
  getPublicTravelTrip,
  parseTravelPreviewScenario,
  travelAtlasEnabled,
  travelPreviewRuntime,
} from "@/lib/server/travel";
import { hasPublicQuery, publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
};

function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  if (!/^[1-9]\d*$/.test(raw)) return 1;
  const candidate = Number(raw);
  return Number.isSafeInteger(candidate) ? Math.min(candidate, 10_000) : 1;
}

function pageSize(value: string | string[] | undefined): 12 | 24 | 36 {
  const raw = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  if (raw === "24") return 24;
  if (raw === "36") return 36;
  return 12;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  if (!travelAtlasEnabled()) {
    return publicPageMetadata({
      title: "Trip not found",
      description: "This travel log is not currently public.",
      path: "/play/travel",
      noindex: true,
    });
  }
  const previewFixture = travelPreviewRuntime() && query.fixture !== undefined
    ? parseTravelPreviewScenario(query.fixture)
    : undefined;
  const result = await getPublicTravelTrip(
    slug,
    1,
    12,
    undefined,
    undefined,
    previewFixture,
  );
  if (result.status !== "ready") {
    return publicPageMetadata({
      title: "Trip not found",
      description: "This travel log is not currently public.",
      path: "/play/travel",
      noindex: true,
    });
  }
  return publicPageMetadata({
    title: `${result.trip.title} · Travel`,
    description: result.trip.summary.slice(0, 160),
    path: `/play/travel/trips/${result.trip.slug}`,
    noindex: hasPublicQuery(query),
  });
}

export default async function TravelTripPage({ params, searchParams }: PageProps) {
  if (!travelAtlasEnabled()) notFound();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const previewFixture = travelPreviewRuntime() && query.fixture !== undefined
    ? parseTravelPreviewScenario(query.fixture)
    : undefined;
  const result = await getPublicTravelTrip(
    slug,
    pageNumber(query.page),
    pageSize(query.pageSize),
    undefined,
    undefined,
    previewFixture,
  );
  if (result.status !== "ready") notFound();
  return <TravelTripLog previewFixture={previewFixture} trip={result.trip} />;
}
