import type { Metadata } from "next";
import { canonicalMetadataOrigin } from "../deployment-environment";
import { runtimeHostedDeploymentPresentation } from "./deployment-presentation";
import { SITE_COPY } from "../copy";
import {
  sitePresentationIdentity,
  socialArtworkAlt,
} from "../seo";

export function runtimeRootMetadata(): Metadata {
  const { titlePrefix, nonProductionHosted } =
    runtimeHostedDeploymentPresentation();
  const identity = sitePresentationIdentity();
  return {
    metadataBase: new URL(canonicalMetadataOrigin()),
    title: {
      default: `${titlePrefix}${SITE_COPY.site["default-title"]}`,
      template: `${titlePrefix}${SITE_COPY.site["title-template"]}`,
    },
    description:
      SITE_COPY.site["root-description"],
    openGraph: {
      title: `${titlePrefix}${SITE_COPY.site["default-title"]}`,
      description: SITE_COPY.site["social-description"],
      type: "website",
      siteName: identity.siteName,
      images: [
        {
          url: "/og.jpg",
          width: 1200,
          height: 630,
          alt: socialArtworkAlt(identity),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${titlePrefix}${SITE_COPY.site["default-title"]}`,
      description: SITE_COPY.site["social-description"],
      images: ["/og.jpg"],
    },
    robots: nonProductionHosted
      ? { index: false, follow: false, noarchive: true, nosnippet: true }
      : { index: true, follow: true },
  };
}
