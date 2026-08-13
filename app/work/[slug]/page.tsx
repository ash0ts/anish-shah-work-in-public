import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { publicBundle } from "@/lib/content";
import { SITE_COPY } from "@/lib/copy";
import { isKnownUnavailablePublicUrl } from "@/lib/public-url-health";
import {
  findWorkGroupBySlugFrom,
  workBuckets,
  workGroupForEntityFrom,
  workGroupPeriodLabel,
} from "@/lib/work-groups";
import {
  findEntityBySlugFrom,
  findItemBySlugFrom,
  getPublicContentView,
  publicMetricsFrom,
} from "@/lib/server/public-content";
import {
  humanizeWorkFilter,
  parseWorkArchiveQuery,
  workArchiveHref,
} from "@/lib/work-archive-query";
import {
  workFacetsForRecord,
  workThemeFacetLabel,
} from "@/lib/work-facets";
import { workArchiveRecordsFrom } from "@/lib/work-index";
import { requestCspNonce } from "@/lib/server/csp";
import {
  absoluteSiteUrl,
  publicPageMetadata,
  safeJsonLd,
  workMetadataDescription,
} from "@/lib/seo";
import type {
  AnishContentBundle,
  ContentDate,
  EvidenceSource,
  PortfolioItem,
  WorkGroup,
} from "@/types/content";
import { WorkDetailDisclosureBehavior } from "./WorkDetailDisclosureBehavior";
import styles from "./case.module.css";

export const dynamic = "force-dynamic";

type WorkDetailProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return workArchiveRecordsFrom(publicBundle).map((record) => ({
    slug: record.slug,
  }));
}

async function resolveGroup(slug: string) {
  const { bundle } = await getPublicContentView();
  const exactGroup = bundle.workGroups.find(
    (group) =>
      group.slug === slug && group.publicationState === "public",
  );
  if (exactGroup) {
    return {
      bundle,
      group: exactGroup,
      legacyAnchor: null as string | null,
      fallbackQuery: null as string | null,
    };
  }

  const item = findItemBySlugFrom(bundle, slug);
  const entity =
    (item
      ? bundle.entities.find(
          (candidate) => candidate.id === item.canonicalEntityId,
        )
      : undefined) ?? findEntityBySlugFrom(bundle, slug);
  const legacyGroup = entity
    ? workGroupForEntityFrom(bundle, entity.id)
    : undefined;
  const aliasedGroup = findWorkGroupBySlugFrom(bundle, slug);
  const resolvedGroup = legacyGroup ?? aliasedGroup ?? null;
  const entityAnchor =
    entity && resolvedGroup?.memberEntityIds.includes(entity.id)
      ? resolvedGroup.memberEntityIds.length > 1
        ? entity.id
        : null
      : entity
        ? entity.itemIds.find((id) => resolvedGroup?.itemIds.includes(id)) ??
          entity.itemIds[0] ??
          null
        : null;
  return {
    bundle,
    group: resolvedGroup,
    legacyAnchor: item?.id ?? entityAnchor,
    fallbackQuery:
      resolvedGroup === null
        ? item?.displayTitle ?? entity?.displayTitle ?? null
        : null,
  };
}

export async function generateMetadata({
  params,
}: WorkDetailProps): Promise<Metadata> {
  const { slug } = await params;
  const { group, fallbackQuery } = await resolveGroup(slug);
  if (!group) {
    return publicPageMetadata({
      title: fallbackQuery ?? "Work record",
      description: fallbackQuery
        ? `Find the bodies of work connected to ${fallbackQuery}.`
        : "This work record is not available in the public archive.",
      path: `/work/${encodeURIComponent(slug)}`,
      noindex: true,
    });
  }
  return publicPageMetadata({
    title: group.shortTitle || group.title,
    description: workMetadataDescription(group.title, group.summary),
    path: `/work/${encodeURIComponent(group.slug)}`,
    type: "article",
  });
}

export default async function WorkDetailPage({ params }: WorkDetailProps) {
  const nonce = await requestCspNonce();
  const { slug } = await params;
  const { bundle, group, legacyAnchor, fallbackQuery } =
    await resolveGroup(slug);
  if (!group && fallbackQuery) {
    permanentRedirect(
      `/work?q=${encodeURIComponent(fallbackQuery)}#work-index`,
    );
  }
  if (!group) notFound();
  if (legacyAnchor || slug !== group.slug) {
    permanentRedirect(
      `/work/${group.slug}${legacyAnchor ? `#${legacyAnchor}` : ""}`,
    );
  }

  const itemById = new Map(bundle.items.map((item) => [item.id, item]));
  const entityById = new Map(
    bundle.entities.map((entity) => [entity.id, entity]),
  );
  const items = group.itemIds
    .map((id) => itemById.get(id))
    .filter(
      (item): item is PortfolioItem =>
        Boolean(item && item.publicationState === "public"),
    )
    .sort(
      (left, right) =>
        (right.date.start ?? "").localeCompare(left.date.start ?? "") ||
        left.displayTitle.localeCompare(right.displayTitle),
    );
  if (!items.length) notFound();
  const primaryEntity = entityById.get(group.primaryEntityId);
  const primary =
    (primaryEntity?.primaryItemId
      ? itemById.get(primaryEntity.primaryItemId)
      : undefined) ?? items[0]!;
  const memberEntities = group.memberEntityIds
    .map((id) => entityById.get(id))
    .filter((entity) => Boolean(entity));
  const evidence = evidenceForItems(bundle, items);
  const directSubjects = new Set([
    group.id,
    ...group.memberEntityIds,
    ...group.itemIds,
  ]);
  const contextSubjects = new Set([
    ...group.programEntityIds,
    ...group.contextEntityIds,
    ...memberEntities.flatMap((entity) => entity?.parentEntityIds ?? []),
  ]);
  const outcomes = publicMetricsFrom(bundle).filter(
    (metric) =>
      metric.displaySurfaces.includes("item_detail") &&
      directSubjects.has(metric.subjectId),
  );
  const context = publicMetricsFrom(bundle).filter(
    (metric) =>
      contextSubjects.has(metric.subjectId) &&
      metric.displaySurfaces.includes("collection"),
  );
  const organizationCandidates = group.organizationIds
    .map(
      (id) =>
        bundle.organizations.find((organization) => organization.id === id)
          ?.name,
    )
    .filter((name): name is string => Boolean(name))
    .map((name) => name.replace(" / GitHub", " · GitHub"));
  const organizations = [...new Set(organizationCandidates)].filter(
    (name, _index, all) =>
      !all.some(
        (candidate) =>
          candidate !== name && candidate.startsWith(`${name} ·`),
      ),
  );
  const bucket =
    workBuckets.find((candidate) => candidate.id === group.bucket)?.title ??
    humanizeWorkFilter(group.bucket);
  const bucketHref = `${workArchiveHref(
    parseWorkArchiveQuery({ bucket: group.bucket }),
  )}#work-index`;
  const archiveRecord = workArchiveRecordsFrom(bundle).find(
    (record) => record.id === group.id,
  );
  const topicFacets = archiveRecord
    ? workFacetsForRecord(archiveRecord).theme.slice(0, 3)
    : [];
  const additionalItems = items.filter((item) => item.id !== primary.id);
  const relatedContextItems = [
    ...new Map(
      [...group.programEntityIds, ...group.contextEntityIds]
        .flatMap((entityId) => entityById.get(entityId)?.itemIds ?? [])
        .filter((itemId) => !group.itemIds.includes(itemId))
        .map((itemId) => itemById.get(itemId))
        .filter(
          (item): item is PortfolioItem =>
            Boolean(item && item.publicationState === "public"),
        )
        .map((item) => [item.id, item]),
    ).values(),
  ].sort(
    (left, right) =>
      (right.date.start ?? "").localeCompare(left.date.start ?? "") ||
      left.displayTitle.localeCompare(right.displayTitle),
  );
  const workUrl = absoluteSiteUrl(`/work/${encodeURIComponent(group.slug)}`);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CreativeWork",
        "@id": `${workUrl}#work`,
        url: workUrl,
        name: group.title,
        headline: group.shortTitle,
        description: workMetadataDescription(group.title, group.summary),
        dateCreated: group.period.start ?? undefined,
        creator: {
          "@type": "Person",
          "@id": `${absoluteSiteUrl("/")}#anish-shah`,
          name: "Anish Shah",
        },
        about: group.topics.map((topic) => humanizeWorkFilter(topic)),
        sameAs: evidence
          .map((source) => source.url)
          .filter((url): url is string => Boolean(url)),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${workUrl}#breadcrumbs`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: absoluteSiteUrl("/"),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Work",
            item: absoluteSiteUrl("/work"),
          },
          {
            "@type": "ListItem",
            position: 3,
            name: group.title,
            item: workUrl,
          },
        ],
      },
    ],
  };
  const hasPrimaryContent = Boolean(
    topicFacets.length ||
      outcomes.length ||
      memberEntities.length > 1 ||
      context.length,
  );

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <WorkDetailDisclosureBehavior />
      <script
        nonce={nonce}
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />
      <header className={styles.hero} id={primary.id}>
        <div className={styles.heroTop}>
          <Link href="/work">← {SITE_COPY.work["detail-back"]}</Link>
          <div className={styles.kicker} aria-label="Work classification">
            <Link href={bucketHref} prefetch={false}>
              {bucket}
            </Link>
            <span>{workGroupPeriodLabel(group)}</span>
          </div>
        </div>
        <h1>{group.title}</h1>
        <div className={styles.intro}>
          <p>{group.summary}</p>
          <PublicArtifactLink item={primary} primary />
        </div>
      </header>

      <dl className={styles.facts} aria-label="Work facts">
        <Fact label={SITE_COPY.work["detail-role"]} value={group.roleSummary} />
        <Fact
          label={SITE_COPY.work["detail-period"]}
          value={formatGroupPeriod(group)}
        />
        <Fact
          label={SITE_COPY.work["detail-organization"]}
          value={organizations.join(" / ") || "Independent"}
        />
      </dl>

      {hasPrimaryContent || evidence.length ? (
        <div
          className={`${styles.content} ${
            hasPrimaryContent ? "" : styles.evidenceOnly
          }`}
        >
          {hasPrimaryContent ? <article className={styles.story}>
            {topicFacets.length ? (
              <div className={styles.topics} aria-label="Topics">
                {topicFacets.map((topic) => (
                  <Link
                    href={`${workArchiveHref(
                      parseWorkArchiveQuery({
                        bucket: group.bucket,
                        topic,
                      }),
                    )}#work-index`}
                    key={topic}
                    prefetch={false}
                  >
                    {workThemeFacetLabel(topic)}
                  </Link>
                ))}
              </div>
            ) : null}

            {outcomes.length ? (
              <section
                className={styles.outcomes}
                aria-labelledby="outcomes-title"
              >
                <p className={styles.sectionLabel}>Direct outcomes</p>
                <h2 id="outcomes-title">{SITE_COPY.work["detail-results"]}</h2>
                <MetricRows metrics={outcomes} />
              </section>
            ) : null}

            {memberEntities.length > 1 ? (
              <section
                className={styles.members}
                aria-labelledby="members-title"
              >
                <h2 id="members-title">{SITE_COPY.work["detail-included"]}</h2>
                <ol>
                  {memberEntities.map((entity) =>
                    entity ? (
                      <li id={entity.id} key={entity.id}>
                        <span>
                          {entity.year ?? "Undated"} · {entity.role}
                        </span>
                        <h3>{entity.displayTitle}</h3>
                        {entity.summary && entity.summary !== group.summary ? (
                          <p>{entity.summary}</p>
                        ) : null}
                      </li>
                    ) : null,
                  )}
                </ol>
              </section>
            ) : null}

            {context.length ? (
              <section
                className={styles.context}
                aria-labelledby="context-title"
              >
                <h2 id="context-title">Wider program</h2>
                <p className={styles.contextNote}>
                  {SITE_COPY.work["detail-context"]}
                </p>
                <MetricRows metrics={context} compact />
              </section>
            ) : null}
          </article> : null}

          {evidence.length ? (
            <aside aria-labelledby="evidence-title" className={styles.evidence}>
              <details
                className={styles.supportingDisclosure}
                data-supporting-disclosure
              >
                <summary>
                  <span className={styles.sectionLabel}>Sources</span>
                  <strong aria-level={2} id="evidence-title" role="heading">
                    {SITE_COPY.work["detail-sources"]}
                  </strong>
                  <i aria-hidden="true">{evidence.length}</i>
                </summary>
                <ol>
                  {evidence.map((source) => (
                    <li key={source.id}>
                      {source.url && !isKnownUnavailablePublicUrl(source.url) ? (
                        <a href={source.url} rel="noreferrer" target="_blank">
                          <span>
                            {source.publisher ?? humanizeWorkFilter(source.kind)}
                          </span>
                          <strong>{source.title}</strong>
                          <i aria-hidden="true">↗</i>
                        </a>
                      ) : (
                        <span>
                          <small>
                            {source.publisher ?? humanizeWorkFilter(source.kind)}
                          </small>
                          <strong>{source.title}</strong>
                          {source.url ? <i>Historical host unavailable</i> : null}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            </aside>
          ) : null}
        </div>
      ) : null}

      {additionalItems.length ? (
        <section
          className={styles.appearances}
          aria-labelledby="appearances-title"
        >
          <details
            className={styles.supportingDisclosure}
            data-supporting-disclosure
          >
            <summary>
              <span className={styles.sectionLabel}>Nested public forms</span>
              <strong aria-level={2} id="appearances-title" role="heading">
                {SITE_COPY.work["detail-materials"]}
              </strong>
              <i aria-hidden="true">{additionalItems.length}</i>
            </summary>
            <ol>
              {additionalItems.map((item) => (
                <li id={item.id} key={item.id}>
                  <div className={styles.formMeta}>
                    <span>{formatDate(item.date)}</span>
                    <span>{humanizeWorkFilter(item.entityRole)}</span>
                  </div>
                  <h3>{appearanceTitle(item, group, primary)}</h3>
                  <p>{item.role}</p>
                  <PublicArtifactLink item={item} />
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : null}

      {relatedContextItems.length ? (
        <section
          className={styles.appearances}
          aria-labelledby="related-context-title"
        >
          <details
            className={styles.supportingDisclosure}
            data-supporting-disclosure
          >
            <summary>
              <span className={styles.sectionLabel}>Related public context</span>
              <strong aria-level={2} id="related-context-title" role="heading">
                {SITE_COPY.work["detail-related"]}
              </strong>
              <i aria-hidden="true">{relatedContextItems.length}</i>
            </summary>
            <ol>
              {relatedContextItems.map((item) => (
                <li id={item.id} key={item.id}>
                  <div className={styles.formMeta}>
                    <span>{formatDate(item.date)}</span>
                    <span>{humanizeWorkFilter(item.type)}</span>
                  </div>
                  <h3>{item.displayTitle}</h3>
                  <p>
                    Related context only. It is not counted as another form of
                    this work.
                  </p>
                  <PublicArtifactLink item={item} />
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : null}
    </main>
  );
}

function MetricRows({
  metrics,
  compact = false,
}: {
  metrics: ReturnType<typeof publicMetricsFrom>;
  compact?: boolean;
}) {
  return (
    <div className={compact ? styles.contextList : styles.outcomeList}>
      {metrics.map((metric) => (
        <article key={metric.id}>
          <strong>{metric.displayValue}</strong>
          <div>
            <h3>{metric.label}</h3>
            {metric.qualifier ? <p>{metric.qualifier}</p> : null}
            {!compact ? (
              <span>
                {metric.attribution} · {metric.sourceLabel} ·{" "}
                {metric.period.label}
                {metric.period.asOf ? ` · as of ${metric.period.asOf}` : ""}
              </span>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function appearanceTitle(
  item: PortfolioItem,
  group: WorkGroup,
  primary: PortfolioItem,
) {
  const title =
    item.displayTitle === group.title
      ? humanizeWorkFilter(item.type)
      : item.displayTitle;
  return item.id === primary.id ? `${title} · primary form` : title;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function evidenceForItems(
  bundle: AnishContentBundle,
  items: PortfolioItem[],
): EvidenceSource[] {
  const ids = new Set(items.flatMap((item) => item.evidenceIds));
  return bundle.evidence.filter(
    (source) => ids.has(source.id) && source.access === "public_web",
  );
}

function formatGroupPeriod(group: WorkGroup) {
  if (
    group.yearStart &&
    group.yearEnd &&
    group.yearStart !== group.yearEnd
  ) {
    return `${group.yearStart}—${group.yearEnd}`;
  }
  return formatDate(group.period);
}

function formatDate(date: ContentDate) {
  if (!date.start) return "Date unlisted";
  if (date.precision === "year") return date.start.slice(0, 4);
  const normalized =
    date.precision === "month" ? `${date.start.slice(0, 7)}-01` : date.start;
  return new Intl.DateTimeFormat("en-US", {
    month: date.precision === "month" ? "long" : "short",
    day: date.precision === "month" ? undefined : "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${normalized}T00:00:00Z`));
}

function PublicArtifactLink({
  item,
  primary = false,
}: {
  item: PortfolioItem;
  primary?: boolean;
}) {
  const url = item.urls.find(({ url: candidate }) =>
    !isKnownUnavailablePublicUrl(candidate),
  );
  if (!url) {
    return (
      <span className={styles.historicalLink}>
        Historical source unavailable
      </span>
    );
  }
  return (
    <a
      className={primary ? styles.primaryArtifact : styles.artifactLink}
      href={url.url}
      rel="noreferrer"
      target="_blank"
    >
      {artifactLinkLabel(item.type)}{" "}
      <span aria-hidden="true">↗</span>
    </a>
  );
}

function artifactLinkLabel(type: PortfolioItem["type"]) {
  const labels: Record<PortfolioItem["type"], string> = {
    event: "View event",
    article: "Read article",
    course: "Open course",
    recording: "Watch recording",
    technical_report: "Read report",
    external_reference: "Open reference",
    producer_credit: "View credit",
    translation: "Read translation",
    mirror: "Open mirror",
    profile: "View profile",
    open_source_repo: "View repository",
    open_source_pr: "View pull request",
  };
  return labels[type];
}
