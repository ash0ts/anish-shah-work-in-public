import type { Metadata } from "next";
import { BodiesOfWork } from "@/components/BodiesOfWork";
import { HomeIntroduction } from "@/components/HomeIntroduction";
import { ImpactEvidence } from "@/components/ImpactEvidence";
import { homepageImpactTracksFrom } from "@/lib/home-impact";
import { featuredWorkBucketsFrom } from "@/lib/work-groups";
import { getPublicContentView } from "@/lib/server/public-content";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Applied AI, in public",
  description:
    "Anish Shah builds agent tooling, evaluation systems, and applied-AI learning programs at Weights & Biases.",
};

export default async function Home() {
  const { bundle } = await getPublicContentView();
  const buckets = featuredWorkBucketsFrom(bundle);
  const impactTracks = homepageImpactTracksFrom(bundle);

  return (
    <main id="main" className={`site-main ${styles.home}`}>
      <HomeIntroduction
        headline={bundle.profile.headline}
        summary={bundle.profile.summary}
      />
      <BodiesOfWork buckets={buckets} />
      <ImpactEvidence tracks={impactTracks} />
    </main>
  );
}
