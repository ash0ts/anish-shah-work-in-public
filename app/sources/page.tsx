import type { Metadata } from "next";
import Link from "next/link";
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
  const methodology = bundle.narratives.find(
    (entry) => entry.placement === "sources",
  );
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
  const publicWorkGroupCount = bundle.workGroups.filter(
    (group) => group.publicationState === "public",
  ).length;

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>The public record</p>
        <h1>Sources, counts, and claims.</h1>
        <p>
          {methodology?.body ??
            "Public counts come from the public inventory. Internally derived outcomes are rounded, dated, and qualified."}
        </p>
        <small>
          {metrics.length} public measures · updated {lastUpdated}
        </small>
      </header>

      <section
        className={styles.accounting}
        aria-labelledby="accounting-title"
      >
        <header>
          <p className={styles.eyebrow}>Archive accounting</p>
          <h2 id="accounting-title">Two inputs, two different outputs.</h2>
          <p>
            Footprint records describe the archive. Impact records support the
            claim ledger. They are reconciled separately.
          </p>
        </header>
        <div className={styles.accountingFlows}>
          <section aria-labelledby="archive-flow-title">
            <h3 id="archive-flow-title">Public archive</h3>
            <ol>
              <li>
                <strong>{bundle.sourceSummary.footprintRows}</strong>
                <span>footprint observations</span>
              </li>
              <li>
                <strong>{publicWorkGroupCount}</strong>
                <span>bodies of work</span>
              </li>
              <li>
                <strong>{bundle.sourceSummary.publicItems}</strong>
                <span>public forms</span>
              </li>
              <li>
                <strong>{bundle.evidence.length}</strong>
                <span>evidence records</span>
              </li>
            </ol>
          </section>
          <section aria-labelledby="impact-flow-title">
            <h3 id="impact-flow-title">Impact ledger</h3>
            <ol>
              <li>
                <strong>{bundle.sourceSummary.impactRows}</strong>
                <span>impact observations reviewed</span>
              </li>
              <li>
                <strong>{metrics.length}</strong>
                <span>rounded public measures</span>
              </li>
            </ol>
          </section>
        </div>
      </section>

      <section
        className={styles.nonClaims}
        aria-labelledby="non-claims-title"
      >
        <header>
          <p className={styles.eyebrow}>Attribution boundary</p>
          <h2 id="non-claims-title">What this site does not claim.</h2>
        </header>
        <ul>
          <li>Pipeline supported is not booked revenue or ARR.</li>
          <li>
            Program reach and organization outcomes are not personal causality.
          </li>
          <li>
            Course enrollments are not unique learners or completion counts.
          </li>
          <li>
            Same-day account creation is an association, not a conversion rate.
          </li>
          <li>
            MCP tool calls describe usage, not users, organizations, or revenue.
          </li>
        </ul>
      </section>

      <section className={styles.rules} id="public-footprint" aria-labelledby="rules-title">
        <header>
          <p className={styles.eyebrow}>Reading rules</p>
          <h2 id="rules-title">Four rules stay visible.</h2>
        </header>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>Count one underlying work once</h3>
              <p>
                All {bundle.sourceSummary.publicItems} public forms remain
                discoverable. Recordings, translations, mirrors, profiles,
                excerpts, and evidence pages do not inflate unique-work totals.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Keep forms attached to their source</h3>
              <p>
                A talk, regional appearance, replay, repository, and translation
                can describe the same body of work without becoming five
                unrelated accomplishments.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Separate contribution from causality</h3>
              <p>
                Individual roles, program reach, supported pipeline, and
                organization-wide outcomes are named separately.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Keep the qualifier beside the number</h3>
              <p>
                Every internally derived measure keeps its time window, source
                class, attribution, rounding, and caveat in the same record.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section
        className={styles.claims}
        id="internal-analytics"
        aria-labelledby="claims-title"
      >
        <header>
          <p className={styles.eyebrow}>Claim ledger</p>
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
                        <span>Public evidence</span>
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
