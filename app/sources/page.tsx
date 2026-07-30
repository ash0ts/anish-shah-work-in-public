import type { Metadata } from "next";
import { SourcesIndex } from "@/components/SourcesIndex";
import {
  getPublicContentView,
  publicMetricsFrom,
} from "@/lib/server/public-content";
import styles from "./sources.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sources and methodology",
  description:
    "Counting rules, attribution language, caveats, and the public bibliography behind Anish Shah’s work archive.",
};

const metricThemes = [
  {
    id: "learning",
    label: "Learning reach",
    description: "Enrollment and launch measures from three AI courses.",
    matches: (id: string) =>
      id.startsWith("metric:courses:") || id.startsWith("metric:course:"),
  },
  {
    id: "product",
    label: "Product adoption",
    description: "Early public-use signals for the W&B MCP Server.",
    matches: (id: string) => id.startsWith("metric:project:"),
  },
  {
    id: "programs",
    label: "Program impact",
    description: "Bounded reach and supported-pipeline measures from event programs.",
    matches: (id: string) =>
      id.startsWith("metric:events:") || id.startsWith("metric:event:"),
  },
  {
    id: "archive",
    label: "Archive reach",
    description: "Counts derived only from the normalized public archive.",
    matches: (id: string) => id.startsWith("metric:archive:"),
  },
] as const;

type SourceSearchParams = Record<
  string,
  string | string[] | undefined
>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
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
  const showAllSources = firstValue(params.sources) === "all";
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
  const entityById = new Map(
    bundle.entities.map((entity) => [entity.id, entity]),
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
            const entity = entityById.get(item.canonicalEntityId);
            return entity
              ? [[
                  entity.id,
                  {
                    id: entity.id,
                    label: entity.displayTitle,
                    href: `/work/${entity.slug}#${item.id}`,
                  },
                ] as const]
              : [];
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
  const groupedMetrics = metricThemes.map((theme) => ({
    ...theme,
    metrics: metrics.filter((metric) => theme.matches(metric.id)),
  }));

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Sources · public evidence</p>
        <h1>Sources and method.</h1>
        <p>
          {methodology?.body ??
            "Public counts come from the public inventory. Internally derived outcomes are rounded, dated, and qualified."}
        </p>
        <small>
          {bundle.sourceSummary.footprintRows} source records · {metrics.length} approved
          public claims · updated {lastUpdated} · version {bundle.contentVersion}
        </small>
      </header>

      <section className={styles.rules} id="public-footprint" aria-labelledby="rules-title">
        <h2 id="rules-title">How to read this archive</h2>
        <div>
          <details>
            <summary>Count one underlying work once</summary>
            <p>
              All {bundle.sourceSummary.publicItems} public forms remain
              discoverable. Recordings, translations, mirrors, profiles,
              excerpts, and evidence pages do not inflate unique-work totals.
            </p>
          </details>
          <details>
            <summary>Separate contribution from causality</summary>
            <p>
              Individual roles, program reach, supported pipeline, and
              organization-wide outcomes are named separately.
            </p>
          </details>
          <details>
            <summary>Keep the qualifier beside the number</summary>
            <p>
              Every internally derived measure keeps its time window, source
              class, rounding, and caveat in the same record.
            </p>
          </details>
        </div>
      </section>

      <section
        className={styles.claims}
        id="internal-analytics"
        aria-labelledby="claims-title"
      >
        <header>
          <p className={styles.eyebrow}>Approved public claim register</p>
          <h2 id="claims-title">{metrics.length} measures in four contexts.</h2>
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
                      <small>
                        {metric.sourceLabel} · {metric.period.label}
                        {metric.period.asOf ? ` · as of ${metric.period.asOf}` : ""}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <SourcesIndex
        entries={sourceEntries}
        kind={sourceKind}
        query={sourceQuery}
        showAll={showAllSources}
      />
    </main>
  );
}
