import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { publicBundle } from "@/lib/content";
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
import { humanizeWorkFilter } from "@/lib/work-archive-query";
import { workArchiveRecordsFrom } from "@/lib/work-index";
import type {
  AnishContentBundle,
  ContentDate,
  EvidenceSource,
  PortfolioItem,
  WorkGroup,
} from "@/types/content";
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
    return {
      title: fallbackQuery ?? "Work record",
      description: fallbackQuery
        ? `Find the bodies of work connected to ${fallbackQuery}.`
        : undefined,
    };
  }
  return {
    title: group.title,
    description: group.summary,
  };
}

export default async function WorkDetailPage({ params }: WorkDetailProps) {
  const { slug } = await params;
  const { bundle, group, legacyAnchor, fallbackQuery } =
    await resolveGroup(slug);
  if (!group && fallbackQuery) {
    redirect(`/work?q=${encodeURIComponent(fallbackQuery)}#work-index`);
  }
  if (!group) notFound();
  if (legacyAnchor || slug !== group.slug) {
    redirect(
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
  const hasMultipleForms = items.length > 1;
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

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header
        className={styles.hero}
        id={!hasMultipleForms ? primary.id : undefined}
      >
        <div className={styles.heroTop}>
          <Link href="/work">← Work index</Link>
          <div className={styles.kicker} aria-label="Work classification">
            <span>{bucket}</span>
            <span>{workGroupPeriodLabel(group)}</span>
            <span>{humanizeWorkFilter(group.verificationState)}</span>
          </div>
        </div>
        <h1>{group.title}</h1>
        <div className={styles.intro}>
          <p>{group.summary}</p>
          {!hasMultipleForms ? (
            <PublicArtifactLink item={primary} primary />
          ) : null}
        </div>
      </header>

      <section className={styles.facts} aria-label="Work facts">
        <Fact label="Documented role" value={group.roleSummary} />
        <Fact label="Period" value={formatGroupPeriod(group)} />
        <Fact
          label="Organization"
          value={organizations.join(" / ") || "Independent/public"}
        />
        <Fact
          label={hasMultipleForms ? "Nested public forms" : "Public form"}
          value={String(items.length)}
        />
      </section>

      <div className={styles.content}>
        <article className={styles.story}>
          {group.topics.length ? (
            <div className={styles.topics} aria-label="Topics">
              {group.topics.map((topic) => (
                <span key={topic}>{humanizeWorkFilter(topic)}</span>
              ))}
            </div>
          ) : null}

          {memberEntities.length > 1 ? (
            <section
              className={styles.members}
              aria-labelledby="members-title"
            >
              <p className={styles.sectionLabel}>Inside this body of work</p>
              <h2 id="members-title">
                {memberEntities.length} connected works, one public story.
              </h2>
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

          {outcomes.length ? (
            <section
              className={styles.outcomes}
              aria-labelledby="outcomes-title"
            >
              <p className={styles.sectionLabel}>Direct outcomes</p>
              <h2 id="outcomes-title">Outcomes attached to this work.</h2>
              <MetricRows metrics={outcomes} />
            </section>
          ) : null}

          {context.length ? (
            <section
              className={styles.context}
              aria-labelledby="context-title"
            >
              <p className={styles.sectionLabel}>
                Program context · not direct attribution
              </p>
              <h2 id="context-title">The wider program.</h2>
              <MetricRows metrics={context} compact />
            </section>
          ) : null}
        </article>

        {evidence.length ? (
          <aside className={styles.evidence}>
            <p className={styles.sectionLabel}>Public evidence</p>
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
          </aside>
        ) : null}
      </div>

      {hasMultipleForms ? (
        <section
          className={styles.appearances}
          aria-labelledby="appearances-title"
        >
          <header>
            <p className={styles.sectionLabel}>Nested public forms</p>
            <h2 id="appearances-title">Appearances and artifacts</h2>
          </header>
          <ol>
            {items.map((item) => (
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
        </section>
      ) : null}

      {relatedContextItems.length ? (
        <section
          className={styles.appearances}
          aria-labelledby="related-context-title"
        >
          <header>
            <p className={styles.sectionLabel}>Related public context</p>
            <h2 id="related-context-title">Programs and references</h2>
          </header>
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
      <span>{label}</span>
      <strong>{value}</strong>
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
      {primary
        ? `Open the ${humanizeWorkFilter(item.type).toLocaleLowerCase()}`
        : "Open this public form"}{" "}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
