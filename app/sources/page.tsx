import type { Metadata } from "next";
import Link from "next/link";
import { SourcesIndex } from "@/components/SourcesIndex";
import {
  getPublicContentView,
  publicMetricsFrom,
} from "@/lib/server/public-content";
import { hasPublicQuery, publicPageMetadata } from "@/lib/seo";
import styles from "./sources.module.css";
import { SITE_COPY } from "@/lib/copy";

export const dynamic = "force-dynamic";

const sourcesDescription = SITE_COPY.sources["seo-description"];

const metricThemeDescriptions = {
  learning: "Enrollment and launch measures from three practical AI courses.",
  product: "Rounded usage and adoption signals for the W&B MCP Server.",
  programs:
    "Bounded reach and supported-pipeline measures from public programs.",
  archive: "Counts derived only from the normalized public archive.",
} as const;

type SourceSearchParams = Record<
  string,
  string | string[] | undefined
>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SourceSearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  return publicPageMetadata({
    title: SITE_COPY.sources["seo-title"],
    description: sourcesDescription,
    path: "/sources",
    noindex: hasPublicQuery(params),
  });
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function positivePage(value: string | string[] | undefined) {
  const parsed = Number.parseInt(firstValue(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<SourceSearchParams>;
}) {
  const [params, { bundle }] = await Promise.all([
    searchParams,
    getPublicContentView(),
  ]);
  const sourceQuery = firstValue(params.q);
  const sourceKind = firstValue(params.kind) || "all";
  const sourceAssociation = firstValue(params.association) || "all";
  const sourcePage = positivePage(params.page);
  const metrics = publicMetricsFrom(bundle);
  const lastUpdated = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(bundle.generatedAt));
  const workGroupByItemId = new Map(
    bundle.workGroups.flatMap((group) =>
      group.itemIds.map((itemId) => [itemId, group] as const),
    ),
  );
  const sourceEntries = bundle.evidence.map((source) => ({
    source,
    linkedWork: [
      ...new Map(
        bundle.items
          .filter(
            (item) =>
              item.publicationState === "public" &&
              item.evidenceIds.includes(source.id),
          )
          .flatMap((item) => {
            const group = workGroupByItemId.get(item.id);
            if (group) {
              return [[
                group.id,
                {
                  id: group.id,
                  label: group.title,
                  href: `/work/${group.slug}#${item.id}`,
                },
              ] as const];
            }
            // Profiles, references, and other context-only observations stay
            // inspectable in Sources without pretending they have a Work page.
            return [];
          }),
      ).values(),
    ],
    linkedClaims: metrics
      .filter((metric) => metric.publicEvidenceIds.includes(source.id))
      .map((metric) => ({
        id: metric.id,
        label: `${metric.displayValue} ${metric.label}`,
        href: `/sources#${metric.id}`,
      })),
  }));
  const metricById = new Map(metrics.map((metric) => [metric.id, metric]));
  const evidenceById = new Map(
    bundle.evidence.map((source) => [source.id, source]),
  );
  const groupedMetrics = bundle.metricGroups
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((group) => ({
      id: group.theme,
      label: group.title,
      description: metricThemeDescriptions[group.theme],
      metrics: group.metricIds.flatMap((id) => {
        const metric = metricById.get(id);
        return metric ? [metric] : [];
      }),
    }));
  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>{SITE_COPY.sources["intro-eyebrow"]}</p>
        <h1>{SITE_COPY.sources["intro-title"]}</h1>
        <p>{SITE_COPY.sources["intro-fallback"]}</p>
        <small>
          {metrics.length} public measures · updated {lastUpdated}
        </small>
      </header>

      <section
        className={styles.claims}
        id="internal-analytics"
        aria-labelledby="claims-title"
      >
        <header>
          <p className={styles.eyebrow}>{SITE_COPY.sources["claims-eyebrow"]}</p>
          <h2 id="claims-title">{metrics.length} claims, each with its limit.</h2>
        </header>
        <div className={styles.themeGroups}>
          {groupedMetrics.map((theme) => (
            <section id={`metric-theme-${theme.id}`} key={theme.id}>
              <header>
                <h3>{theme.label}</h3>
                <p>{theme.description}</p>
              </header>
              <div>
                {theme.metrics.map((metric) => (
                  <article id={metric.id} key={metric.id}>
                    <strong>{metric.displayValue}</strong>
                    <div>
                      <h4>{metric.label}</h4>
                      <p>{metric.qualifier}</p>
                      <dl className={styles.metricContext}>
                        <div>
                          <dt>Scope</dt>
                          <dd>{metric.scope.replaceAll("_", " ")}</dd>
                        </div>
                        <div>
                          <dt>Attribution</dt>
                          <dd>{metric.attribution.replaceAll("_", " ")}</dd>
                        </div>
                        <div>
                          <dt>Period</dt>
                          <dd>
                            {metric.period.label}
                            {metric.period.asOf
                              ? ` · as of ${metric.period.asOf}`
                              : ""}
                          </dd>
                        </div>
                        <div>
                          <dt>Source class</dt>
                          <dd>{metric.sourceLabel}</dd>
                        </div>
                      </dl>
                      <div className={styles.metricEvidence}>
                        <span>Sources</span>
                        {metric.publicEvidenceIds.flatMap((evidenceId) => {
                          const source = evidenceById.get(evidenceId);
                          if (!source) return [];
                          const query = new URLSearchParams({
                            association: "claim",
                            q: source.title,
                          });
                          return [
                            <Link
                              href={`/sources?${query.toString()}#${source.id}`}
                              key={source.id}
                              prefetch={false}
                            >
                              {source.title}
                            </Link>,
                          ];
                        })}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className={styles.rules} id="public-footprint" aria-labelledby="rules-title">
        <header>
          <p className={styles.eyebrow}>{SITE_COPY.sources["rules-eyebrow"]}</p>
          <h2 id="rules-title">{SITE_COPY.sources["rules-title"]}</h2>
          <p>
            {bundle.sourceSummary.footprintRows} source observations resolve to{" "}
            {bundle.workGroups.length} projects and series. Related records stay
            searchable without inflating that count.
          </p>
        </header>
        <ol>
          {[
            ["01", "rule-1-title", "rule-1-body"],
            ["02", "rule-3-title", "rule-3-body"],
            ["03", "rule-4-title", "rule-4-body"],
          ].map(([number, titleKey, bodyKey]) => (
            <li key={number}>
              <span>{number}</span>
              <div>
                <h3>{SITE_COPY.sources[titleKey as keyof typeof SITE_COPY.sources]}</h3>
                <p>{SITE_COPY.sources[bodyKey as keyof typeof SITE_COPY.sources]}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <SourcesIndex
        entries={sourceEntries}
        association={sourceAssociation}
        kind={sourceKind}
        page={sourcePage}
        query={sourceQuery}
      />
    </main>
  );
}
