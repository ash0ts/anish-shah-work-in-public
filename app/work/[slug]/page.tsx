import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  formatDate,
  formatItemType,
  publicBundle,
} from "@/lib/content";
import {
  evidenceForItemFrom,
  findItemBySlugFrom,
  getPublicContentView,
  metricsForItemFrom,
  organizationNamesFrom,
  relatedItemsFrom,
} from "@/lib/server/public-content";
import { isKnownUnavailablePublicUrl } from "@/lib/public-url-health";

export const dynamic = "force-dynamic";

type WorkDetailProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return publicBundle.items
    .filter((item) => item.publicationState === "public")
    .map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({
  params,
}: WorkDetailProps): Promise<Metadata> {
  const { slug } = await params;
  const { bundle } = await getPublicContentView();
  const item = findItemBySlugFrom(bundle, slug);
  if (!item) return { title: "Work record" };
  return {
    title: item.title,
    description:
      item.summary ??
      `${item.role} record from Anish Shah’s public applied AI archive.`,
  };
}

export default async function WorkDetailPage({ params }: WorkDetailProps) {
  const { slug } = await params;
  const { bundle } = await getPublicContentView();
  const item = findItemBySlugFrom(bundle, slug);
  if (!item) notFound();

  const organizations = organizationNamesFrom(bundle, item);
  const evidence = evidenceForItemFrom(bundle, item);
  const outcomes = metricsForItemFrom(bundle, item);
  const related = relatedItemsFrom(bundle, item).slice(0, 8);
  const primaryPublicUrl = item.urls.find(
    ({ url }) => !isKnownUnavailablePublicUrl(url),
  );

  return (
    <main id="main" className="site-main">
      <header className="case-hero">
        <Link className="back-link" href="/work">
          ← Public index
        </Link>
        <div className="case-kicker">
          <span>{formatItemType(item.type)}</span>
          <span>{item.year ?? "Date open"}</span>
          <span>{item.verificationState.replaceAll("_", " ")}</span>
        </div>
        <h1>{item.title}</h1>
        <div className="case-hero-close">
          <p>
            {item.summary ??
              `A public record of Anish’s documented role—${item.role}—with the artifact, context, and available evidence kept together.`}
          </p>
          {primaryPublicUrl ? (
            <a
              className="primary-action"
              href={primaryPublicUrl.url}
              rel="noreferrer"
              target="_blank"
            >
              Open the public artifact <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </div>
      </header>

      <section className="case-facts" aria-label="Record facts">
        <div>
          <span>Role</span>
          <strong>{item.role}</strong>
        </div>
        <div>
          <span>Date</span>
          <strong>{formatDate(item)}</strong>
        </div>
        <div>
          <span>Organization</span>
          <strong>{organizations.join(" / ") || "Independent/public"}</strong>
        </div>
        <div>
          <span>Location</span>
          <strong>{item.location.label || "Not listed"}</strong>
        </div>
      </section>

      <section className="case-body">
        <aside className="case-poster" aria-hidden="true">
          <span>{item.year ?? "NOW"}</span>
          <strong>{formatItemType(item.type).toUpperCase()}</strong>
          <i>{item.title}</i>
        </aside>
        <div className="case-narrative">
          <p className="utility-label">What this record establishes</p>
          <h2>The artifact comes first.</h2>
          <p>
            This page does not infer ownership beyond the documented role. It
            keeps the public artifact, its publication or event date, the
            contributing organization, and any outcome language in one place so
            the record can be inspected rather than taken on faith.
          </p>
          {item.topics.length ? (
            <div className="case-topics" aria-label="Topics">
              {item.topics.map((topic) => (
                <span key={topic}>{topic}</span>
              ))}
            </div>
          ) : null}

          {outcomes.length ? (
            <div className="case-outcomes">
              <p className="utility-label">Qualified outcomes</p>
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
            </div>
          ) : null}
        </div>
        <aside className="case-resources">
          <p className="utility-label">Public resources</p>
          <ul>
            {item.urls.map((url) => (
              <li key={url.url}>
                {isKnownUnavailablePublicUrl(url.url) ? (
                  <span>
                    {url.kind === "primary"
                      ? "Historical source"
                      : "Related historical source"}{" "}
                    · host unavailable
                  </span>
                ) : (
                  <a href={url.url} rel="noreferrer" target="_blank">
                    {url.kind === "primary"
                      ? "Primary artifact"
                      : "Related resource"}
                    <span aria-hidden="true">↗</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="utility-label">Evidence</p>
          <ul>
            {evidence.map((source) => (
              <li key={source.id}>
                {source.url && !isKnownUnavailablePublicUrl(source.url) ? (
                  <a href={source.url} rel="noreferrer" target="_blank">
                    {source.title}
                    <span aria-hidden="true">↗</span>
                  </a>
                ) : source.url ? (
                  <span>{source.title} · host unavailable</span>
                ) : (
                  <span>{source.title}</span>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </section>

      {related.length ? (
        <section className="related-work" aria-labelledby="related-title">
          <p className="utility-label">Connected records</p>
          <h2 id="related-title">One work, several public lives.</h2>
          <div>
            {related.map(({ item: relatedItem, relation }) => (
              <Link href={`/work/${relatedItem.slug}`} key={relation.id}>
                <span>{relation.predicate.replaceAll("_", " ")}</span>
                <strong>{relatedItem.title}</strong>
                <i aria-hidden="true">↗</i>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
