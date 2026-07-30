import type { Metadata } from "next";
import Link from "next/link";
import { HeroStage } from "@/components/HeroStage";
import { resolveCareerChapters } from "@/lib/career-chapters";
import {
  getPublicContentView,
  homepageMetricsFrom,
} from "@/lib/server/public-content";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Applied AI, in public",
  description:
    "Anish Shah builds applied AI products, learning systems, and technical communities at Weights & Biases.",
};

export default async function Home() {
  const { bundle } = await getPublicContentView();
  const career = resolveCareerChapters(bundle);
  const metrics = homepageMetricsFrom(bundle);

  return (
    <main id="main" className={`site-main ${styles.home}`}>
      <HeroStage
        chapters={career.chapters}
        defaultChapterId={career.defaultChapterId}
        canEnhanceWithThree={career.canEnhanceWithThree}
        headline={bundle.profile.headline}
        summary={bundle.profile.summary}
      />

      <section className={styles.impact} aria-labelledby="impact-title">
        <header>
          <div>
            <p>Selected impact · qualified at source</p>
            <h2 id="impact-title">Impact, in context.</h2>
          </div>
          <Link href="/sources#internal-analytics">
            Sources &amp; methodology <span aria-hidden="true">↗</span>
          </Link>
        </header>
        <div className={styles.metricList}>
          {metrics.map((metric) => (
            <article key={metric.id}>
              <strong>{metric.displayValue}</strong>
              <div>
                <h3>{metric.label}</h3>
                <p>{metric.qualifier}</p>
                <span>
                  {metric.sourceLabel} · {metric.period.label}
                  {metric.period.asOf ? ` · as of ${metric.period.asOf}` : ""}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
