import type { MetadataRoute } from "next";

const fallbackSiteUrl =
  "https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site";

function siteUrl() {
  return (process.env.SITE_URL || fallbackSiteUrl).replace(/\/+$/, "");
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/studio",
        "/api/",
        "/signin-with-chatgpt",
        "/signout-with-chatgpt",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
