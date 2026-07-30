import type { Metadata } from "next";
import Link from "next/link";
import { BodiesOfWork } from "@/components/BodiesOfWork";
import { HomeIntroduction } from "@/components/HomeIntroduction";
import { featuredWorkBucketsFrom } from "@/lib/work-groups";
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
  const buckets = featuredWorkBucketsFrom(bundle);
  const metrics = homepageMetricsFrom(bundle);

  return (
    <main id="main" className={`site-main ${styles.home}`}>
      <HomeIntroduction
        headline={bundle.profile.headline}
        summary={bundle.profile.summary}
      />
      <BodiesOfWork buckets={buckets} />

      <section className={styles.impact} aria-labelledby="impact-title">
        <header>
          <div>
            <p>Selected impact · claim and limit stay together</p>
            <h2 id="impact-title">Four signals. Four different scopes.</h2>
          </div>
          <Link href="/sources#internal-analytics">
            Read the full claim ledger <span aria-hidden="true">↗</span>
          </Link>
        </header>
        <ol className={styles.metricList}>
          {metrics.map((metric) => (
            <li key={metric.id}>
              <span className={styles.metricScope}>
                {metricLedgerLabel(metric.id)}
              </span>
              <strong>{metric.displayValue}</strong>
              <div>
                <h3>{metric.label}</h3>
                <p>{metric.qualifier}</p>
                <span>
                  {metric.attribution} · {metric.sourceLabel} ·{" "}
                  {metric.period.label}
                  {metric.period.asOf ? ` · as of ${metric.period.asOf}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function metricLedgerLabel(metricId: string) {
  if (metricId.includes("courses:")) return "Learning";
  if (metricId.includes("fully-connected")) return "Gathering";
  if (metricId.includes("pipeline")) return "Programs";
  return "Product";
}
