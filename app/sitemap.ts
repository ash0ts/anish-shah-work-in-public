import type { MetadataRoute } from "next";
import { canonicalMetadataOrigin } from "../lib/deployment-environment";
import { getPublicContentView } from "../lib/server/public-content";
import { runtimeHostedDeploymentPresentation } from "../lib/server/deployment-presentation";
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

  return [...publicRoutes, ...workRoutes];
}
