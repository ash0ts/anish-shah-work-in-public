import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { FilteredResultFocus } from "@/components/FilteredResultFocus";
import {
  filterWorkArchiveRecords,
  legacyMapRedirectPath,
  matchingChildForQuery,
  parseWorkArchiveQuery,
  workArchiveHref,
  type WorkSearchParams,
} from "@/lib/work-archive-query";
import {
  countWorkFacetOptions,
  mediaFacetDefinitions,
  workFacetsForRecord,
} from "@/lib/work-facets";
import { workBuckets } from "@/lib/work-groups";
import { workArchiveRecordsFrom, type WorkArchiveRecord } from "@/lib/work-index";
import { getPublicContentView } from "@/lib/server/public-content";
import { hasPublicQuery, publicPageMetadata } from "@/lib/seo";
import { WorkTimeline } from "./WorkTimeline";
import { SITE_COPY } from "@/lib/copy";
import styles from "./work.module.css";

export const dynamic = "force-dynamic";

const workDescription = SITE_COPY.work["seo-description"];

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<WorkSearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  return publicPageMetadata({
    title: SITE_COPY.work["seo-title"],
    description: workDescription,
    path: "/work",
    noindex: hasPublicQuery(params),
  });
}

const collator = new Intl.Collator("en", { sensitivity: "base" });
const mediaLabels = new Map(
  mediaFacetDefinitions.map(({ id, label }) => [id, label]),
);

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<WorkSearchParams>;
}) {
  const [params, { bundle }] = await Promise.all([
    searchParams,
    getPublicContentView(),
  ]);
  const mapRedirect = legacyMapRedirectPath(params);
  if (mapRedirect) permanentRedirect(mapRedirect);

  const query = parseWorkArchiveQuery(params);
  const allWorks = workArchiveRecordsFrom(bundle).sort(
    (left, right) =>
      (right.year ?? -1) - (left.year ?? -1) ||
      collator.compare(left.title, right.title),
  );
  const filtered = filterWorkArchiveRecords(allWorks, query);
  const perPage = 24;
  const pageCount = Math.max(Math.ceil(filtered.length / perPage), 1);
  const selectedPage = Math.min(query.page, pageCount);
  const pageStart = (selectedPage - 1) * perPage;
  const visibleWorks = filtered.slice(pageStart, pageStart + perPage);
  const firstVisibleBucketId = workBuckets.find((bucket) =>
    visibleWorks.some((work) => work.bucket === bucket.id),
  )?.id;
  const timelineRecords = filterWorkArchiveRecords(allWorks, {
    ...query,
    bucket: "",
    year: "",
  });
  const options = {
    buckets: workBuckets.map((bucket) => ({
      value: bucket.id,
      label: bucket.shortTitle,
      count: allWorks.filter((work) => work.bucket === bucket.id).length,
    })),
    topics: countWorkFacetOptions(allWorks, "theme"),
    years: availableYears(allWorks),
    formats: countWorkFacetOptions(allWorks, "media"),
  };
  const activeFilterCount = [
    query.bucket,
    query.topic,
    query.year,
    query.format,
    query.organization,
    query.role,
  ].filter(Boolean).length;
  const secondaryFilterCount = query.format ? 1 : 0;
  const hasScopedResults = Boolean(
    query.query || activeFilterCount || query.practice,
  );
  const resultLabel = `${filtered.length} ${
    filtered.length === 1 ? "project" : "projects"
  }`;
  const explorerHeading = query.query
    ? `Results for “${query.query}”`
    : activeFilterCount
      ? SITE_COPY.work["index-filtered-heading"]
      : SITE_COPY.work["index-default-heading"];

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.masthead}>
        <p className={styles.eyebrow}>
          {SITE_COPY.work["masthead-eyebrow"]}
        </p>
        <div className={styles.mastheadBody}>
          <h1>{SITE_COPY.work["masthead-title"]}</h1>
          <p>{SITE_COPY.work["masthead-summary"]}</p>
        </div>
      </header>

      <section className={styles.tools} aria-labelledby="work-search-title">
        <form
          action="/work#work-index"
          method="get"
          className={styles.filterForm}
        >
          {query.practice ? (
            <input name="practice" type="hidden" value={query.practice} />
          ) : null}
          {query.organization ? (
            <input name="organization" type="hidden" value={query.organization} />
          ) : null}
          {query.role ? (
            <input name="role" type="hidden" value={query.role} />
          ) : null}
          <label className={styles.search}>
            <span id="work-search-title">{SITE_COPY.work["search-label"]}</span>
            <input
              defaultValue={query.query}
              name="q"
              placeholder={SITE_COPY.work["search-placeholder"]}
              type="search"
            />
          </label>

          <div className={styles.filterBody}>
            <div className={styles.primaryFilters}>
              <FilterSelect
                allLabel="All lines"
                label="Line of work"
                name="bucket"
                value={query.bucket}
                options={options.buckets}
              />
              <FilterSelect
                allLabel="All topics"
                label="Topic"
                name="topic"
                value={query.topic}
                options={options.topics}
              />
              <FilterSelect
                allLabel="All years"
                label="Year"
                name="year"
                value={query.year}
                options={options.years}
              />
            </div>

            <details
              className={styles.moreFilters}
              id="work-more-filters"
              open={Boolean(query.format)}
            >
              <summary>
                More filters
                {secondaryFilterCount
                  ? ` · ${secondaryFilterCount} active`
                  : ""}
              </summary>
              <div className={styles.secondaryFilters}>
                <FilterSelect
                  allLabel="All formats"
                  label="Format"
                  name="format"
                  value={query.format}
                  options={options.formats}
                />
              </div>
            </details>
            <button type="submit">{SITE_COPY.work["filter-submit"]}</button>
          </div>

          <Link className={styles.clear} href="/work" prefetch={false}>
            {SITE_COPY.work["clear-search"]}
          </Link>
        </form>
      </section>

      <WorkTimeline query={query} records={timelineRecords} />

      <section
        aria-labelledby="work-index-title"
        className={styles.index}
        id="work-index"
      >
        <header className={styles.indexHeader}>
          <p
            aria-atomic="true"
            aria-live="polite"
            className={styles.resultCount}
            role="status"
          >
            {resultLabel}
          </p>
          <h2 id="work-index-title" tabIndex={-1}>
            {explorerHeading}
          </h2>
        </header>
        <FilteredResultFocus
          active={hasScopedResults || query.page > 1}
          targetId="work-index-title"
        />

        <div className={styles.bodyIndex}>
          {workBuckets.map((bucket) => {
            const works = visibleWorks.filter(
              (work) => work.bucket === bucket.id,
            );
            if (!works.length) return null;
            return (
              <details
                className={styles.body}
                data-work-body={bucket.id}
                key={bucket.id}
                open={
                  hasScopedResults
                    ? works.length > 0
                    : bucket.id === firstVisibleBucketId
                }
              >
                <summary>
                  <div>
                    <h3>{bucket.title}</h3>
                  </div>
                  <i aria-hidden="true">+</i>
                </summary>
                <ol className={styles.workList}>
                  {works.map((work) => (
                    <WorkRow
                      key={work.id}
                      query={query.query}
                      work={work}
                    />
                  ))}
                </ol>
              </details>
            );
          })}
        </div>

        {pageCount > 1 ? (
          <nav className={styles.pagination} aria-label="Work pages">
            {selectedPage > 1 ? (
              <Link
                href={`${workArchiveHref(query, { page: selectedPage - 1 })}#work-index`}
                prefetch={false}
              >
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span>
              Page {selectedPage} of {pageCount}
            </span>
            {selectedPage < pageCount ? (
              <Link
                href={`${workArchiveHref(query, { page: selectedPage + 1 })}#work-index`}
                prefetch={false}
              >
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}

        {!filtered.length ? (
          <div className={styles.empty}>
            <p>{SITE_COPY.work["no-results"]}</p>
            <Link href="/work" prefetch={false}>
              {SITE_COPY.work["clear-search"]}
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function WorkRow({
  query,
  work,
}: {
  query: string;
  work: WorkArchiveRecord;
}) {
  const matchingChild = matchingChildForQuery(work, query);
  const facets = workFacetsForRecord(work);
  const medium = facets.media
    .map((id) => mediaLabels.get(id))
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
  const support = matchingChild
    ? `Matched: ${matchingChild.displayTitle}`
    : work.role || medium;

  return (
    <li data-work-id={work.id}>
      <Link
        className={styles.workRow}
        prefetch={false}
        href={`/work/${work.slug}${
          matchingChild ? `#${matchingChild.id}` : ""
        }`}
      >
        <span className={styles.year}>{periodLabel(work)}</span>
        <span className={styles.workTitle}>
          <strong>{work.title}</strong>
          {support ? <small>{support}</small> : null}
        </span>
        <i aria-hidden="true">↗</i>
      </Link>
    </li>
  );
}

function FilterSelect({
  allLabel,
  label,
  name,
  value,
  options,
}: {
  allLabel: string;
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string; count: number }>;
}) {
  return (
    <label className={styles.select}>
      <span>{label}</span>
      <select defaultValue={value} name={name}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} · {option.count}
          </option>
        ))}
      </select>
    </label>
  );
}

function availableYears(records: WorkArchiveRecord[]) {
  const years = [
    ...new Set(
      records.flatMap((work) => {
        const start = work.yearStart ?? work.yearEnd;
        const end = work.yearEnd ?? work.yearStart;
        if (start === null || end === null) return [];
        return Array.from(
          { length: Math.max(end - start + 1, 1) },
          (_, index) => start + index,
        );
      }),
    ),
  ].sort((left, right) => right - left);
  return years.map((year) => ({
    value: String(year),
    label: String(year),
    count: records.filter((work) => activeInYear(work, year)).length,
  }));
}

function activeInYear(work: WorkArchiveRecord, year: number) {
  const start = work.yearStart ?? work.yearEnd;
  const end = work.yearEnd ?? work.yearStart;
  return start !== null && end !== null && year >= start && year <= end;
}

function periodLabel(work: WorkArchiveRecord) {
  if (
    work.yearStart &&
    work.yearEnd &&
    work.yearStart !== work.yearEnd
  ) {
    return `${work.yearStart}—${String(work.yearEnd).slice(-2)}`;
  }
  return String(work.yearEnd ?? work.yearStart ?? "Date unavailable");
}
