import type { Metadata } from "next";

const fallbackSiteUrl =
  "https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site";

export function siteOrigin(): string {
  return (
    process.env.SITE_URL ||
    process.env.PRODUCTION_SITE_URL ||
    fallbackSiteUrl
  ).replace(/\/+$/, "");
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
  const socialTitle = `${title} — Anish Shah`;

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
      siteName: "Anish Shah",
      images: [
        {
          url: absoluteSiteUrl("/og.jpg"),
          width: 1200,
          height: 630,
          alt: "Anish Shah — applied AI, in public",
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
  const cleaned = summary.replace(/\s+/g, " ").trim();
  const looksLikePlaceholder =
    /^(author|contributor|presenter|speaker|repository owner)\.?$/i.test(
      cleaned,
    ) ||
    /^\d{1,2}:\d{2}$/.test(cleaned) ||
    /^(no replay|exact .*not recovered|latest indexed copy)/i.test(cleaned);

  if (!looksLikePlaceholder && cleaned.length >= 80 && cleaned.length <= 160) {
    return cleaned;
  }

  const lead = `Explore Anish Shah’s work on ${title}, with its documented role, public artifacts, related appearances, and inspectable evidence.`;
  if (lead.length <= 160) return lead;
  return `${lead.slice(0, 157).trimEnd()}…`;
}

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
