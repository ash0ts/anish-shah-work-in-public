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
import type {
  AnishContentBundle,
  ContentDate,
  EvidenceSource,
  PortfolioItem,
} from "@/types/content";

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
  const entity = findEntityBySlugFrom(bundle, slug);
  if (entity) return { bundle, entity, legacyItem: null };
  const item = findItemBySlugFrom(bundle, slug);
  const itemEntity = item ? entityForItemFrom(bundle, item) : undefined;
  return itemEntity
    ? { bundle, entity: itemEntity, legacyItem: item ?? null }
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
  const primary =
    items.find((item) => item.id === entity.primaryItemId) ?? items[0] ?? null;
  const evidence = evidenceForItems(bundle, items);
  const itemIds = new Set(items.map((item) => item.id));
  const outcomes = publicMetricsFrom(bundle).filter(
    (metric) =>
      metric.displaySurfaces.includes("item_detail") &&
      (metric.subjectId === entity.id || itemIds.has(metric.subjectId)),
  );
  const context = publicMetricsFrom(bundle).filter(
    (metric) =>
      entity.parentEntityIds.includes(metric.subjectId) &&
      metric.displaySurfaces.includes("collection"),
  );
  const organizationCandidates = entity.organizationIds
    .map(
      (id) =>
        bundle.organizations.find((organization) => organization.id === id)?.name,
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

  return (
    <main id="main" className="site-main v11-case">
      <header className="v11-case-hero">
        <Link href="/work">← Work index</Link>
        <div className="v11-case-kicker">
          <span>{entity.practice}</span>
          <span>{entity.kind}</span>
          <span>{entity.year ?? "Undated"}</span>
          <span>{entity.verificationState.replaceAll("_", " ")}</span>
        </div>
        <h1>{entity.displayTitle}</h1>
        <div className="v11-case-intro">
          <p>{entity.summary}</p>
          {primary ? <PublicArtifactLink item={primary} primary /> : null}
        </div>
      </header>

      <section className="v11-case-facts" aria-label="Work facts">
        <div><span>Documented role</span><strong>{entity.role}</strong></div>
        <div><span>Representative date</span><strong>{formatDate(entity.representativeDate)}</strong></div>
        <div><span>Organization</span><strong>{organizations.join(" / ") || "Independent/public"}</strong></div>
        <div><span>Public forms</span><strong>{items.length}</strong></div>
      </section>

      <div className="v11-case-layout">
        <article className="v11-case-story">
          <p className="utility-label">The underlying work</p>
          <h2>{entity.shortTitle}</h2>
          <p>{entity.summary}</p>
          {entity.topics.length ? (
            <div className="v11-case-topics" aria-label="Topics">
              {entity.topics.map((topic) => <span key={topic}>{topic}</span>)}
            </div>
          ) : null}

          {outcomes.length ? (
            <section className="v11-case-outcomes" aria-labelledby="outcomes-title">
              <p className="utility-label">Direct outcomes</p>
              <h2 id="outcomes-title">What is explicitly attached.</h2>
              {outcomes.map((metric) => (
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
            </section>
          ) : null}

          {context.length ? (
            <section className="v11-case-context" aria-labelledby="context-title">
              <p className="utility-label">Program context · not direct attribution</p>
              <h2 id="context-title">The wider program.</h2>
              {context.map((metric) => (
                <article key={metric.id}>
                  <strong>{metric.displayValue}</strong>
                  <p>{metric.label}</p>
                  <span>{metric.qualifier}</span>
                </article>
              ))}
            </section>
          ) : null}
        </article>

        <aside className="v11-case-evidence">
          <p className="utility-label">Public evidence</p>
          <ol>
            {evidence.map((source) => (
              <li key={source.id}>
                {source.url && !isKnownUnavailablePublicUrl(source.url) ? (
                  <a href={source.url} rel="noreferrer" target="_blank">
                    <span>{source.publisher ?? source.kind.replaceAll("_", " ")}</span>
                    <strong>{source.title}</strong>
                    <i aria-hidden="true">↗</i>
                  </a>
                ) : (
                  <span>
                    <small>{source.publisher ?? source.kind.replaceAll("_", " ")}</small>
                    <strong>{source.title}</strong>
                    {source.url ? <i>Historical host unavailable</i> : null}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <section className="v11-public-forms" aria-labelledby="forms-title">
        <header>
          <p className="utility-label">Occurrences and artifacts</p>
          <h2 id="forms-title">
            {items.length === 1 ? "One public form." : `${items.length} public forms, connected.`}
          </h2>
        </header>
        <ol>
          {items.map((item) => (
            <li id={item.id} key={item.id}>
              <div>
                <span>{formatDate(item.date)}</span>
                <span>{item.entityRole.replaceAll("_", " ")}</span>
              </div>
              <h3>{item.displayTitle}</h3>
              <p>{item.role}</p>
              <PublicArtifactLink item={item} />
            </li>
          ))}
        </ol>
      </section>
    </main>
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
  if (!url) return <span className="v11-historical-link">Historical source unavailable</span>;
  return (
    <a
      className={primary ? "primary-action" : "v11-artifact-link"}
      href={url.url}
      rel="noreferrer"
      target="_blank"
    >
      {primary ? "Open the primary artifact" : "Open this public form"}{" "}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
