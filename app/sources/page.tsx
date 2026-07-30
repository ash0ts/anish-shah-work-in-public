import type { Metadata } from "next";
import { SourcesIndex } from "@/components/SourcesIndex";
import {
  getPublicContentView,
  publicMetricsFrom,
} from "@/lib/server/public-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sources and methodology",
  description:
    "Counting rules, attribution language, caveats, and the public bibliography behind Anish Shah’s work archive.",
};

export default async function SourcesPage() {
  const { bundle } = await getPublicContentView();
  const metrics = publicMetricsFrom(bundle);
  const methodology = bundle.narratives.find(
    (entry) => entry.placement === "sources",
  );
  const lastUpdated = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(bundle.generatedAt));
  const sourceEntries = bundle.evidence.map((source) => ({
    source,
    linkedWork: bundle.items
      .filter(
        (item) =>
          item.publicationState === "public" &&
          item.evidenceIds.includes(source.id),
      )
      .map((item) => ({
        id: item.id,
        label: item.title,
        href: `/work/${item.slug}`,
      })),
    linkedClaims: metrics
      .filter((metric) => metric.publicEvidenceIds.includes(source.id))
      .map((metric) => ({
        id: metric.id,
        label: `${metric.displayValue} ${metric.label}`,
        href: `/sources#${metric.id}`,
      })),
  }));

  return (
    <main id="main" className="site-main">
      <header className="sources-hero">
        <div className="sources-hero-meta">
          <p className="utility-label">Sources · method before magnitude</p>
          <p>
            Updated {lastUpdated} · version {bundle.contentVersion}
          </p>
        </div>
        <h1>Read the claim. Keep reading.</h1>
        <p>
          {methodology?.body ??
            "Public counts come from the public inventory. Internally derived outcomes are rounded, dated, and qualified."}
        </p>
      </header>

      <section className="method-grid" aria-label="Counting methodology">
        <article id="public-footprint">
          <span>Count</span>
          <h2>One underlying work stays one work.</h2>
          <p>
            Recordings, translations, mirrors, profiles, excerpts, and evidence
            pages remain discoverable but cannot inflate canonical totals.
          </p>
        </article>
        <article>
          <span>Attribute</span>
          <h2>Contribution is not organization-wide causality.</h2>
          <p>
            Individual roles, program reach, supported pipeline, and
            organizational outcomes are named separately.
          </p>
        </article>
        <article>
          <span>Qualify</span>
          <h2>Every internal measure carries its edges.</h2>
          <p>
            The display keeps the time window, source class, rounding, and
            caveat beside the number.
          </p>
        </article>
      </section>

      <section
        className="claim-register"
        id="internal-analytics"
        aria-labelledby="claims-title"
      >
        <div>
          <p className="utility-label">Approved public claim register</p>
          <h2 id="claims-title">{metrics.length} measures, deliberately bounded.</h2>
        </div>
        <div>
          {metrics.map((metric) => (
            <article id={metric.id} key={metric.id}>
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

      <SourcesIndex entries={sourceEntries} />
    </main>
  );
}
