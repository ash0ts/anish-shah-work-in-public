import type { Metadata } from "next";
import { canonicalMetadataOrigin } from "../deployment-environment";
import { runtimeHostedDeploymentPresentation } from "./deployment-presentation";

export function runtimeRootMetadata(): Metadata {
  const { titlePrefix, nonProductionHosted } =
    runtimeHostedDeploymentPresentation();
  return {
    metadataBase: new URL(canonicalMetadataOrigin()),
    title: {
      default: `${titlePrefix}Anish Shah — Applied AI, in public`,
      template: `${titlePrefix}%s — Anish Shah`,
    },
    description:
      "An inspectable archive of Anish Shah’s work across applied AI, education, products, and technical communities.",
    openGraph: {
      title: `${titlePrefix}Anish Shah — Applied AI, in public`,
      description:
        "Products, education, open source, and technical communities—with the public work attached.",
      type: "website",
      images: [{ url: "/og.jpg", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${titlePrefix}Anish Shah — Applied AI, in public`,
      description:
        "Products, education, open source, and technical communities—with the public work attached.",
      images: ["/og.jpg"],
    },
    robots: nonProductionHosted
      ? { index: false, follow: false, noarchive: true, nosnippet: true }
      : { index: true, follow: true },
  };
}
