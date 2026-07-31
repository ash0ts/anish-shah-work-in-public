import type { MetadataRoute } from "next";
import { PUBLIC_SITE_ORIGIN } from "@/lib/site-constants";

function siteUrl() {
  return (
    process.env.SITE_URL ||
    process.env.PRODUCTION_SITE_URL ||
    PUBLIC_SITE_ORIGIN
  ).replace(/\/+$/, "");
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
