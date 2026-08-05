import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { FilteredResultFocus } from "@/components/FilteredResultFocus";
import {
  WorkOrganizations,
  type WorkOrganizationSectionView,
} from "@/components/WorkOrganizations";
import {
  filterWorkArchiveRecords,
  legacyMapRedirectPath,
  matchingChildForQuery,
  paginateWorkArchiveRecords,
  parseWorkArchiveQuery,
  workArchiveHref,
  workOrganizationFilterLabel,
  type WorkSearchParams,
} from "@/lib/work-archive-query";
import {
  countWorkFacetOptions,
  mediaFacetDefinitions,
  workFacetsForRecord,
} from "@/lib/work-facets";
import { workBuckets } from "@/lib/work-groups";
import { workArchiveRecordsFrom, type WorkArchiveRecord } from "@/lib/work-index";
import { workOrganizationSectionsFrom } from "@/lib/work-organizations";
import { getPublicContentView } from "@/lib/server/public-content";
import { hasPublicQuery, publicPageMetadata } from "@/lib/seo";
import { WorkBodyBehavior } from "./WorkBodyBehavior";
import { WorkMobileFilters } from "./WorkMobileFilters";
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
  const organizationSections: WorkOrganizationSectionView[] =
    workOrganizationSectionsFrom(bundle).map((section) => ({
      id: section.id,
      label:
        section.id === "built-at"
          ? SITE_COPY.work["organizations-built-at"]
          : section.id === "contributed-to"
            ? SITE_COPY.work["organizations-contributed-to"]
            : SITE_COPY.work["organizations-presented-with"],
      marks: section.marks.map((mark) => ({
        id: mark.id,
        name: mark.name,
        relationship: mark.group,
        secondaryRelationships: mark.secondaryGroups,
        projectCount: mark.projectCount,
        logo: mark.logo ? { src: mark.logo.assetPath } : null,
      })),
    }));
  const filtered = filterWorkArchiveRecords(allWorks, query);
  const page = paginateWorkArchiveRecords(filtered, query.page);
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
  if (query.page > 1 && !hasScopedResults) {
    permanentRedirect("/work");
  }
  const selectedBucket = workBuckets.find(
    (bucket) => bucket.id === query.bucket,
  );
  const selectedOrganizationName = query.organization
    ? (bundle.organizations.find(({ id }) => id === query.organization)?.name ??
      workOrganizationFilterLabel(query.organization))
    : null;
  const resultLabel = filtered.length
    ? page.totalPages > 1
      ? `Showing ${page.rangeStart}—${page.rangeEnd} of ${filtered.length} projects`
      : `${filtered.length} ${filtered.length === 1 ? "project" : "projects"}`
    : "No projects found";
  const explorerHeading = query.query
    ? `Results for “${query.query}”`
    : selectedOrganizationName
      ? `${selectedOrganizationName} projects`
    : selectedBucket && query.year
      ? `${selectedBucket.title} · ${query.year}`
      : selectedBucket
        ? selectedBucket.title
        : query.year
          ? `Projects from ${query.year}`
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

      <nav aria-label="Work sections" className={styles.sectionNav}>
        <a href="#work-calendar">{SITE_COPY.work["section-nav-calendar"]}</a>
        <span aria-hidden="true">·</span>
        <a href="#work-organizations">
          {SITE_COPY.work["section-nav-organizations"]}
        </a>
      </nav>

      <section className={styles.tools} aria-labelledby="work-search-title">
        <div className={styles.filterToolbar}>
          <form
            action="/work#work-index"
            method="get"
            className={styles.filterForm}
            id="work-search-form"
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

            <div className={styles.primaryFilters}>
              <FilterSelect
                allLabel="All lines"
                label="Line of work"
                name="bucket"
                value={query.bucket}
                options={options.buckets}
              />
              <FilterSelect
                allLabel="All years"
                label="Year"
                name="year"
                value={query.year}
                options={options.years}
              />
              <FilterSelect
                allLabel="All topics"
                label="Topic"
                name="topic"
                value={query.topic}
                options={options.topics}
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

            <div className={styles.filterActions}>
              <button type="submit">{SITE_COPY.work["filter-submit"]}</button>
              <Link className={styles.clear} href="/work" prefetch={false}>
                {SITE_COPY.work["clear-search"]}
              </Link>
            </div>
          </form>
          <WorkMobileFilters
            activeFilterCount={secondaryFilterCount}
            fallbackFiltersId="work-more-filters"
            formId="work-search-form"
            options={options}
            query={query}
          />
        </div>
      </section>

      <WorkTimeline query={query} records={timelineRecords} />

      <WorkOrganizations
        eyebrow={SITE_COPY.work["organizations-eyebrow"]}
        sections={organizationSections}
        selectedOrganizationId={query.organization || null}
        summary={SITE_COPY.work["organizations-summary"]}
        title={SITE_COPY.work["organizations-title"]}
      />

      {hasScopedResults ? (
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
            active
            key={workArchiveHref(query)}
            targetId="work-index-title"
          />

          <div className={styles.bodyIndex}>
            {workBuckets.map((bucket) => {
              const works = page.items.filter(
                (work) => work.bucket === bucket.id,
              );
              if (!works.length) return null;
              return (
                <details
                  className={styles.body}
                  data-default-open="true"
                  data-work-body={bucket.id}
                  key={bucket.id}
                  open
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

          <WorkBodyBehavior />

          {!filtered.length ? (
            <div className={styles.empty}>
              <p>{SITE_COPY.work["no-results"]}</p>
              <Link href="/work" prefetch={false}>
                {SITE_COPY.work["clear-search"]}
              </Link>
            </div>
          ) : null}

          {page.totalPages > 1 ? (
            <WorkPagination page={page.currentPage} query={query} totalPages={page.totalPages} />
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function WorkPagination({
  page,
  query,
  totalPages,
}: {
  page: number;
  query: ReturnType<typeof parseWorkArchiveQuery>;
  totalPages: number;
}) {
  const pages = paginationWindow(page, totalPages);
  return (
    <nav aria-label="Work result pages" className={styles.pagination}>
      {page > 1 ? (
        <Link
          href={`${workArchiveHref(query, { page: page - 1 })}#work-index`}
          prefetch={false}
          rel="prev"
        >
          Previous
        </Link>
      ) : (
        <span aria-disabled="true">Previous</span>
      )}
      <ol>
        {pages.map((pageNumber) => (
          <li key={pageNumber}>
            {pageNumber === page ? (
              <span aria-current="page">{pageNumber}</span>
            ) : (
              <Link
                aria-label={`Page ${pageNumber}`}
                href={`${workArchiveHref(query, { page: pageNumber })}#work-index`}
                prefetch={false}
              >
                {pageNumber}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {page < totalPages ? (
        <Link
          href={`${workArchiveHref(query, { page: page + 1 })}#work-index`}
          prefetch={false}
          rel="next"
        >
          Next
        </Link>
      ) : (
        <span aria-disabled="true">Next</span>
      )}
    </nav>
  );
}

function paginationWindow(currentPage: number, totalPages: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const start = Math.min(
    Math.max(1, currentPage - 2),
    Math.max(1, totalPages - 4),
  );
  return Array.from({ length: 5 }, (_, index) => start + index);
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
