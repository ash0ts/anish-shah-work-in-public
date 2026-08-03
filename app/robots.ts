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
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
