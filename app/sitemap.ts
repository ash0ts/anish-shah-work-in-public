import type { MetadataRoute } from "next";
import { getPublicContentView } from "@/lib/server/public-content";
import { workArchiveRecordsFrom } from "@/lib/work-index";

const fallbackSiteUrl =
  "https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.SITE_URL || fallbackSiteUrl).replace(
    /\/+$/,
    "",
  );
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
      url: `${baseUrl}/about`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
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
