import type { Metadata } from "next";
import type { AnishContentBundle } from "../types/content";
import {
  canonicalMetadataOrigin,
} from "./deployment-environment";
import { SITE_COPY } from "./copy";

export type SitePresentationIdentity = {
  siteName: string;
  homeTitle: string;
  titleTemplate: string;
  defaultTitle: string;
};

export function sitePresentationIdentity(): SitePresentationIdentity {
  return {
    siteName: SITE_COPY.site["header-wordmark"],
    homeTitle: SITE_COPY.home["seo-title"],
    titleTemplate: SITE_COPY.site["title-template"],
    defaultTitle: SITE_COPY.site["default-title"],
  };
}

export function socialPageTitle(
  title: string,
  identity: SitePresentationIdentity = sitePresentationIdentity(),
): string {
  return identity.titleTemplate.replace("%s", title);
}

export function socialArtworkAlt(
  identity: SitePresentationIdentity = sitePresentationIdentity(),
): string {
  return identity.defaultTitle;
}

export function siteOrigin(): string {
  return canonicalMetadataOrigin().replace(/\/+$/, "");
}

export function absoluteSiteUrl(path = "/"): string {
  return new URL(path, `${siteOrigin()}/`).toString();
}

type PublicPageMetadataInput = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  type?: "website" | "article" | "profile";
};

export function publicPageMetadata({
  title,
  description,
  path,
  noindex = false,
  type = "website",
}: PublicPageMetadataInput): Metadata {
  const canonical = absoluteSiteUrl(path);
  const identity = sitePresentationIdentity();
  const socialTitle = socialPageTitle(title, identity);

  return {
    title,
    description,
    alternates: { canonical },
    robots: noindex
      ? { index: false, follow: true }
      : { index: true, follow: true },
    openGraph: {
      title: socialTitle,
      description,
      type,
      url: canonical,
      siteName: identity.siteName,
      images: [
        {
          url: absoluteSiteUrl("/og.jpg"),
          width: 1200,
          height: 630,
          alt: socialArtworkAlt(identity),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [absoluteSiteUrl("/og.jpg")],
    },
  };
}

export function buildHomeStructuredData(
  bundle: Pick<AnishContentBundle, "profile">,
  profileUrl: string,
  identity: SitePresentationIdentity = sitePresentationIdentity(),
) {
  const personId = `${profileUrl}#anish-shah`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": `${profileUrl}#profile-page`,
        url: profileUrl,
        name: socialPageTitle(identity.homeTitle, identity),
        description: bundle.profile.summary,
        mainEntity: { "@id": personId },
      },
      {
        "@type": "Person",
        "@id": personId,
        name: bundle.profile.name,
        url: profileUrl,
        jobTitle: bundle.profile.headline,
        description: bundle.profile.summary,
        sameAs: bundle.profile.links.map((link) => link.href),
        worksFor: {
          "@type": "Organization",
          name: "Weights & Biases",
          url: "https://wandb.ai/",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${profileUrl}#website`,
        url: profileUrl,
        name: identity.siteName,
        description: SITE_COPY.site["root-description"],
        publisher: { "@id": personId },
      },
    ],
  };
}

export function buildAboutStructuredData(
  profileUrl: string,
  title: string,
  description: string,
  identity: SitePresentationIdentity = sitePresentationIdentity(),
) {
  const homeUrl = absoluteSiteUrl("/");
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": `${profileUrl}#profile-page`,
    url: profileUrl,
    name: socialPageTitle(title, identity),
    description,
    mainEntity: { "@id": `${homeUrl}#anish-shah` },
    isPartOf: { "@id": `${homeUrl}#website` },
  };
}

export function hasPublicQuery(
  values: Record<string, string | string[] | undefined>,
): boolean {
  return Object.values(values).some((value) =>
    Array.isArray(value) ? value.some(Boolean) : Boolean(value),
  );
}

export function workMetadataDescription(
  title: string,
  summary: string,
): string {
  const minimumLength = 80;
  const maximumLength = 160;
  const cleaned = summary.replace(/\s+/g, " ").trim();
  const looksLikePlaceholder =
    /^(author|contributor|presenter|speaker|repository owner)\.?$/i.test(
      cleaned,
    ) ||
    /^\d{1,2}:\d{2}$/.test(cleaned) ||
    /^(no replay|exact .*not recovered|latest indexed copy)/i.test(cleaned);

  if (!looksLikePlaceholder && cleaned.length >= minimumLength) {
    if (cleaned.length <= maximumLength) return cleaned;
  } else if (!looksLikePlaceholder && cleaned) {
    const completeSummary = /[.!?]$/u.test(cleaned) ? cleaned : `${cleaned}.`;
    const expanded = `${completeSummary} See the role, project materials, and sources.`;
    if (expanded.length >= minimumLength && expanded.length <= maximumLength) {
      return expanded;
    }
  }

  const lead = `Explore ${title}, including Anish Shah’s role, project materials, and supporting sources.`;
  if (lead.length >= minimumLength && lead.length <= maximumLength) return lead;
  return "Explore the role, project materials, related appearances, and supporting sources.";
}

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
