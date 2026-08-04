import type { MetadataRoute } from "next";
import { ROOM_OBJECTS } from "../components/play/room-platform/room-registry";
import { canonicalMetadataOrigin } from "../lib/deployment-environment";
import { runtimeHostedDeploymentPresentation } from "../lib/server/deployment-presentation";
import { roomExperienceEnabled } from "../lib/server/play-experience";
import { simulationExperienceEnabled } from "../lib/server/simulation/policy";
import { getPublicContentView } from "../lib/server/public-content";
import { workArchiveRecordsFrom } from "../lib/work-index";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (runtimeHostedDeploymentPresentation().nonProductionHosted) {
    return [];
  }
  const baseUrl = canonicalMetadataOrigin().replace(/\/+$/, "");
  const { bundle } = await getPublicContentView();
  const lastModified = new Date(bundle.generatedAt);
  const publicRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${baseUrl}/work`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/play`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/sources`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
  const workSlugs = new Set(
    workArchiveRecordsFrom(bundle).map((work) => work.slug),
  );
  const workRoutes: MetadataRoute.Sitemap = [...workSlugs].map((slug) => ({
    url: `${baseUrl}/work/${encodeURIComponent(slug)}`,
    lastModified,
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  const playRoutes: MetadataRoute.Sitemap = roomExperienceEnabled()
    ? ROOM_OBJECTS.map((object) => ({
        url: `${baseUrl}${object.route}`,
        lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.4,
      }))
    : [];

  const simulationRoutes: MetadataRoute.Sitemap = simulationExperienceEnabled()
    ? [
        {
          url: `${baseUrl}/simulation`,
          lastModified,
          changeFrequency: "monthly",
          priority: 0.5,
        },
      ]
    : [];

  return [...publicRoutes, ...playRoutes, ...simulationRoutes, ...workRoutes];
}
