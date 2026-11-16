import type { MetadataRoute } from "next";
import { canonicalMetadataOrigin } from "../lib/deployment-environment";
import { runtimeHostedDeploymentPresentation } from "../lib/server/deployment-presentation";

function siteUrl() {
  return canonicalMetadataOrigin().replace(/\/+$/, "");
}

export default function robots(): MetadataRoute.Robots {
  if (runtimeHostedDeploymentPresentation().nonProductionHosted) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/studio",
        "/api/",
        "/signin-with-chatgpt",
        "/signout-with-chatgpt",
        // Keep the four bucket-only entry points and their page links open.
        // Robots is crawl advice, not authorization or a deindexing guarantee.
        ...["q", "topic", "year", "organization", "organizations", "format", "role", "practice", "view"]
          .flatMap((parameter) => [`/work?*${parameter}=`, `/work/?*${parameter}=`]),
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
