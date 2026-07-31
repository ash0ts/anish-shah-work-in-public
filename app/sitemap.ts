import type { MetadataRoute } from "next";
import { PUBLIC_SITE_ORIGIN } from "@/lib/site-constants";
import { getPublicContentView } from "@/lib/server/public-content";
import { workArchiveRecordsFrom } from "@/lib/work-index";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (
    process.env.SITE_URL ||
    process.env.PRODUCTION_SITE_URL ||
    PUBLIC_SITE_ORIGIN
  ).replace(/\/+$/, "");
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
