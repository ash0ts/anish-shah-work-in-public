import type { Metadata } from "next";
import { BodiesOfWork } from "@/components/BodiesOfWork";
import { HomeIntroduction } from "@/components/HomeIntroduction";
import { ImpactEvidence } from "@/components/ImpactEvidence";
import { homepageImpactTracksFrom } from "@/lib/home-impact";
import { featuredWorkBucketsFrom } from "@/lib/work-groups";
import { getPublicContentView } from "@/lib/server/public-content";
import { requestCspNonce } from "@/lib/server/csp";
import {
  absoluteSiteUrl,
  buildHomeStructuredData,
  publicPageMetadata,
  safeJsonLd,
} from "@/lib/seo";
import { SITE_COPY } from "@/lib/copy";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: SITE_COPY.home["seo-title"],
  description: SITE_COPY.home["seo-description"],
  path: "/",
  type: "profile",
});

export default async function Home() {
  const nonce = await requestCspNonce();
  const { bundle } = await getPublicContentView();
  const buckets = featuredWorkBucketsFrom(bundle);
  const impactTracks = homepageImpactTracksFrom(bundle);
  const profileUrl = absoluteSiteUrl("/");
  const structuredData = buildHomeStructuredData(bundle, profileUrl);

  return (
    <main id="main" className={`site-main ${styles.home}`}>
      <script
        nonce={nonce}
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />
      <HomeIntroduction
        headline={bundle.profile.headline}
        summary={bundle.profile.summary}
      />
      <BodiesOfWork buckets={buckets} />
      <ImpactEvidence tracks={impactTracks} />
    </main>
  );
}
