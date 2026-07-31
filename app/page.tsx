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
  publicPageMetadata,
  safeJsonLd,
} from "@/lib/seo";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: "Applied AI, in public",
  description:
    "Anish Shah builds agent tooling, evaluation systems, and applied-AI learning programs at Weights & Biases.",
  path: "/",
  type: "profile",
});

export default async function Home() {
  const nonce = await requestCspNonce();
  const { bundle } = await getPublicContentView();
  const buckets = featuredWorkBucketsFrom(bundle);
  const impactTracks = homepageImpactTracksFrom(bundle);
  const profileUrl = absoluteSiteUrl("/");
  const personId = `${profileUrl}#anish-shah`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": `${profileUrl}#profile-page`,
        url: profileUrl,
        name: "Anish Shah — Applied AI, in public",
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
        name: "Anish Shah",
        description:
          "Public work across applied AI systems, education, open source, and technical communities.",
        publisher: { "@id": personId },
      },
    ],
  };

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
