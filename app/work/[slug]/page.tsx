import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { publicBundle } from "@/lib/content";
import { isKnownUnavailablePublicUrl } from "@/lib/public-url-health";
import {
  entityForItemFrom,
  findEntityBySlugFrom,
  findItemBySlugFrom,
  getPublicContentView,
  itemsForEntityFrom,
  publicMetricsFrom,
  workIndexEntriesFrom,
} from "@/lib/server/public-content";
import { humanizeWorkFilter } from "@/lib/work-archive-query";
import type {
  AnishContentBundle,
  ContentDate,
  EvidenceSource,
  PortfolioItem,
} from "@/types/content";
import styles from "./case.module.css";

export const dynamic = "force-dynamic";

type WorkDetailProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return workIndexEntriesFrom(publicBundle).map((entity) => ({
    slug: entity.slug,
  }));
}

async function resolveEntity(slug: string) {
  const { bundle } = await getPublicContentView();
  const exactEntity = bundle.entities.find(
    (entity) =>
      entity.slug === slug && entity.publicationState === "public",
  );
  if (exactEntity) return { bundle, entity: exactEntity, legacyItem: null };

  const item = findItemBySlugFrom(bundle, slug);
  const itemEntity = item ? entityForItemFrom(bundle, item) : undefined;
  if (itemEntity) {
    return { bundle, entity: itemEntity, legacyItem: item ?? null };
  }

  const aliasedEntity = findEntityBySlugFrom(bundle, slug);
  return aliasedEntity
    ? { bundle, entity: aliasedEntity, legacyItem: null }
    : { bundle, entity: null, legacyItem: null };
}

export async function generateMetadata({
  params,
}: WorkDetailProps): Promise<Metadata> {
  const { slug } = await params;
  const { entity } = await resolveEntity(slug);
  if (!entity) return { title: "Work record" };
  return {
    title: entity.displayTitle,
    description: entity.summary,
  };
}

export default async function WorkDetailPage({ params }: WorkDetailProps) {
  const { slug } = await params;
  const { bundle, entity, legacyItem } = await resolveEntity(slug);
  if (!entity) notFound();
  if (legacyItem || slug !== entity.slug) {
    const anchor = legacyItem ? `#${legacyItem.id}` : "";
    redirect(`/work/${entity.slug}${anchor}`);
  }

  const items = itemsForEntityFrom(bundle, entity).sort(
    (left, right) =>
      (right.date.start ?? "").localeCompare(left.date.start ?? "") ||
      left.displayTitle.localeCompare(right.displayTitle),
  );
  if (!items.length) notFound();
  const primary =
    items.find((item) => item.id === entity.primaryItemId) ?? items[0]!;
  const evidence = evidenceForItems(bundle, items);
  const directItemIds = new Set(entity.itemIds);
  const outcomes = publicMetricsFrom(bundle).filter(
    (metric) =>
      metric.displaySurfaces.includes("item_detail") &&
      (metric.subjectId === entity.id || directItemIds.has(metric.subjectId)),
  );
  const context = publicMetricsFrom(bundle).filter(
    (metric) =>
      entity.parentEntityIds.includes(metric.subjectId) &&
      metric.displaySurfaces.includes("collection"),
  );
  const organizationCandidates = entity.organizationIds
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
  const hasMultipleForms = items.length > 1;

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.hero}>
        <div className={styles.heroTop}>
          <Link href="/work">← Work index</Link>
          <div className={styles.kicker} aria-label="Work classification">
            <span>{humanizeWorkFilter(entity.kind)}</span>
            <span>{entity.year ?? "Undated"}</span>
            <span>{humanizeWorkFilter(entity.verificationState)}</span>
          </div>
        </div>
        <h1>{entity.displayTitle}</h1>
        <div className={styles.intro}>
          <p>{entity.summary}</p>
          {!hasMultipleForms && primary ? (
            <PublicArtifactLink item={primary} primary />
          ) : null}
        </div>
      </header>

      <section className={styles.facts} aria-label="Work facts">
        <Fact label="Documented role" value={entity.role} />
        <Fact
          label="Representative date"
          value={formatDate(entity.representativeDate)}
        />
        <Fact
          label="Organization"
          value={organizations.join(" / ") || "Independent/public"}
        />
        <Fact
          label={hasMultipleForms ? "Connected forms" : "Public form"}
          value={String(items.length)}
        />
      </section>

      <div className={styles.content}>
        <article className={styles.story}>
          {entity.topics.length ? (
            <div className={styles.topics} aria-label="Topics">
              {entity.topics.map((topic) => (
                <span key={topic}>{humanizeWorkFilter(topic)}</span>
              ))}
            </div>
          ) : null}

          {outcomes.length ? (
            <section
              className={styles.outcomes}
              aria-labelledby="outcomes-title"
            >
              <p className={styles.sectionLabel}>Direct outcomes</p>
              <h2 id="outcomes-title">Outcomes attached to this work.</h2>
              <div className={styles.outcomeList}>
                {outcomes.map((metric) => (
                  <article key={metric.id}>
                    <strong>{metric.displayValue}</strong>
                    <div>
                      <h3>{metric.label}</h3>
                      {metric.qualifier ? <p>{metric.qualifier}</p> : null}
                      <span>
                        {metric.sourceLabel} · {metric.period.label}
                        {metric.period.asOf
                          ? ` · as of ${metric.period.asOf}`
                          : ""}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
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
              {context.map((metric) => (
                <article key={metric.id}>
                  <strong>{metric.displayValue}</strong>
                  <div>
                    <h3>{metric.label}</h3>
                    {metric.qualifier ? <p>{metric.qualifier}</p> : null}
                  </div>
                </article>
              ))}
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
                        {source.publisher ??
                          humanizeWorkFilter(source.kind)}
                      </span>
                      <strong>{source.title}</strong>
                      <i aria-hidden="true">↗</i>
                    </a>
                  ) : (
                    <span>
                      <small>
                        {source.publisher ??
                          humanizeWorkFilter(source.kind)}
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
            <p className={styles.sectionLabel}>Connected public forms</p>
            <h2 id="appearances-title">Appearances and artifacts</h2>
          </header>
          <ol>
            {items.map((item) => (
              <li id={item.id} key={item.id}>
                <div className={styles.formMeta}>
                  <span>{formatDate(item.date)}</span>
                  <span>{humanizeWorkFilter(item.entityRole)}</span>
                </div>
                <h3>
                  {appearanceTitle(item, entity.displayTitle, primary)}
                </h3>
                <p>{item.role}</p>
                <PublicArtifactLink item={item} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}

function appearanceTitle(
  item: PortfolioItem,
  entityTitle: string,
  primary: PortfolioItem,
) {
  const title =
    item.displayTitle === entityTitle
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
