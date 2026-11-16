import type { MetadataRoute } from "next";
import { ROOM_OBJECTS } from "../components/play/room-platform/room-registry";
import { canonicalMetadataOrigin } from "../lib/deployment-environment";
import { runtimeHostedDeploymentPresentation } from "../lib/server/deployment-presentation";
import {
  getPublicTravelAtlas,
  travelAtlasEnabled,
} from "../lib/server/travel";
import { simulationExperienceMode } from "../lib/server/simulation/mode";
import { getPublicContentView } from "../lib/server/public-content";
import { workArchiveRecordsFrom } from "../lib/work-index";

// Publication and Travel visibility are live owner decisions, not build-time
// metadata. Never let the framework retain this response across requests.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (runtimeHostedDeploymentPresentation().nonProductionHosted) {
    return [];
  }
  const baseUrl = canonicalMetadataOrigin().replace(/\/+$/, "");
  const { bundle } = await getPublicContentView();
  const publicRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${baseUrl}/work`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/about`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/play`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/sources`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/privacy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
  const workSlugs = new Set(
    workArchiveRecordsFrom(bundle).map((work) => work.slug),
  );
  const workRoutes: MetadataRoute.Sitemap = [...workSlugs].map((slug) => ({
    url: `${baseUrl}/work/${encodeURIComponent(slug)}`,
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  const travelEnabled = travelAtlasEnabled();
  const playRoutes: MetadataRoute.Sitemap = ROOM_OBJECTS.filter(
    ({ id }) => id !== "travel" || travelEnabled,
  ).map((object) => ({
    url: `${baseUrl}${object.route}`,
    changeFrequency: "weekly" as const,
    priority: 0.4,
  }));

  const simulationRoutes: MetadataRoute.Sitemap = simulationExperienceMode() === "campaign-v1"
    ? [
        {
          url: `${baseUrl}/simulation`,
          changeFrequency: "monthly",
          priority: 0.5,
        },
      ]
    : [];
  const atlas = travelEnabled ? await getPublicTravelAtlas() : null;
  const tripRoutes: MetadataRoute.Sitemap =
    atlas?.status === "ready"
      ? atlas.atlas.trips.map((trip) => ({
          url: `${baseUrl}/play/travel/trips/${encodeURIComponent(trip.slug)}`,
          lastModified: new Date(atlas.atlas.publishedAt),
          changeFrequency: "monthly" as const,
          priority: 0.35,
        }))
      : [];

  return [
    ...publicRoutes,
    ...playRoutes,
    ...simulationRoutes,
    ...tripRoutes,
    ...workRoutes,
  ];
}
