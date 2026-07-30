import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StoryTimeMatrix } from "@/components/StoryTimeMatrix";
import {
  filterWorkArchiveRecords,
  humanizeWorkFilter,
  legacyMapRedirectPath,
  matchingChildForQuery,
  parseWorkArchiveQuery,
  workArchiveHref,
  type WorkSearchParams,
} from "@/lib/work-archive-query";
import { getPublicContentView } from "@/lib/server/public-content";
import { workArchiveRecordsFrom } from "@/lib/work-index";
import { workBuckets } from "@/lib/work-groups";
import { WorkFilterBehavior } from "./WorkFilterBehavior";
import styles from "./work.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Work",
  description:
    "An index of Anish Shah’s applied AI products, courses, writing, open-source work, talks, and their public forms.",
};

const collator = new Intl.Collator("en", { sensitivity: "base" });

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
  if (mapRedirect) redirect(mapRedirect);

  const query = parseWorkArchiveQuery(params);
  const allWorks = workArchiveRecordsFrom(bundle).sort(
    (left, right) =>
      (right.year ?? -1) - (left.year ?? -1) ||
      collator.compare(left.title, right.title),
  );
  const filtered = filterWorkArchiveRecords(allWorks, query);
  const perPage = 24;
  const pageCount = Math.max(Math.ceil(filtered.length / perPage), 1);
  const page = Math.min(query.page, pageCount);
  const pageWorks = filtered.slice((page - 1) * perPage, page * perPage);
  const organizationNames = new Map(
    bundle.organizations.map((entry) => [entry.id, entry.name]),
  );
  const options = {
    buckets: workBuckets,
    topics: [...new Set(allWorks.flatMap((work) => work.topics))]
      .filter(Boolean)
      .sort(collator.compare),
    years: [
      ...new Set(
        allWorks.flatMap((work) => {
          if (work.yearStart === null && work.yearEnd === null) {
            return ["undated"];
          }
          const start = work.yearStart ?? work.yearEnd!;
          const end = work.yearEnd ?? work.yearStart!;
          return Array.from(
            { length: Math.max(end - start + 1, 1) },
            (_, index) => String(start + index),
          );
        }),
      ),
    ].sort(
      (left, right) =>
        left === "undated"
          ? 1
          : right === "undated"
            ? -1
            : Number(right) - Number(left),
    ),
    formats: [...new Set(allWorks.flatMap((work) => work.formats))]
      .filter(Boolean)
      .sort(collator.compare),
    organizations: [
      ...new Set(allWorks.flatMap((work) => work.organizationIds)),
    ]
      .map((id) => ({ id, name: organizationNames.get(id) ?? id }))
      .sort((left, right) => collator.compare(left.name, right.name)),
    roles: [...new Set(allWorks.map((work) => work.role).filter(Boolean))].sort(
      collator.compare,
    ),
  };
  const activeFilterCount = [
    query.bucket,
    query.topic,
    query.year,
    query.format,
    query.organization,
    query.role,
  ].filter(Boolean).length;
  const secondaryFilterCount = [query.organization, query.role].filter(
    Boolean,
  ).length;
  const showStoryTime =
    !query.query && activeFilterCount === 0 && !query.practice;

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.masthead}>
        <p className={styles.eyebrow}>
          {allWorks.length} bodies of work · 2021—now
        </p>
        <div className={styles.mastheadBody}>
          <h1>Work, grouped by the story it tells.</h1>
          <p>
            One body of work can surface as a product, course, article, talk,
            recording, repository, or regional appearance. Those forms remain
            attached here.
          </p>
        </div>
      </header>

      <section className={styles.tools} aria-labelledby="work-search-title">
        <form action="/work" method="get" className={styles.filterForm}>
          {query.practice ? (
            <input name="practice" type="hidden" value={query.practice} />
          ) : null}
          <label className={styles.search}>
            <span id="work-search-title">Search work and public forms</span>
            <input
              defaultValue={query.query}
              name="q"
              placeholder="Agents, evaluation, MCP, LangChain…"
              type="search"
            />
          </label>

          <details
            className={styles.filterDisclosure}
            id="work-filters"
          >
            <summary>
              <span>Filters</span>
              <span>
                {activeFilterCount
                  ? `${activeFilterCount} active`
                  : "Body, topic, year, format"}
              </span>
            </summary>
            <div className={styles.filterBody}>
              <div className={styles.primaryFilters}>
                <FilterSelect
                  label="Body"
                  name="bucket"
                  value={query.bucket}
                  options={options.buckets.map((bucket) => ({
                    value: bucket.id,
                    label: bucket.shortTitle,
                  }))}
                />
                <FilterSelect
                  label="Topic"
                  name="topic"
                  value={query.topic}
                  options={options.topics.map((value) => ({
                    value,
                    label: humanizeWorkFilter(value),
                  }))}
                />
                <FilterSelect
                  label="Year"
                  name="year"
                  value={query.year}
                  options={options.years.map((value) => ({
                    value: String(value),
                    label: value === "undated" ? "Undated" : String(value),
                  }))}
                />
                <FilterSelect
                  label="Format"
                  name="format"
                  value={query.format}
                  options={options.formats.map((value) => ({
                    value,
                    label: humanizeWorkFilter(value),
                  }))}
                />
              </div>

              <details
                className={styles.moreFilters}
                id="work-more-filters"
              >
                <summary>
                  More filters
                  {secondaryFilterCount
                    ? ` · ${secondaryFilterCount} active`
                    : ""}
                </summary>
                <div className={styles.secondaryFilters}>
                  <FilterSelect
                    label="Organization"
                    name="organization"
                    value={query.organization}
                    options={options.organizations.map(({ id, name }) => ({
                      value: id,
                      label: name,
                    }))}
                  />
                  <FilterSelect
                    label="Role"
                    name="role"
                    value={query.role}
                    options={options.roles.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </div>
              </details>
              <WorkFilterBehavior
                filtersId="work-filters"
                moreFiltersId="work-more-filters"
              />

              <button type="submit">Show work</button>
            </div>
          </details>

          <Link className={styles.clear} href="/work">
            Clear
          </Link>
        </form>
      </section>

      {showStoryTime ? (
        <StoryTimeMatrix records={allWorks} />
      ) : null}

      <section
        className={styles.index}
        aria-labelledby="work-index-title"
        id="work-index"
      >
        <header className={styles.indexHeader}>
          <div>
            <p className={styles.resultCount}>
              {filtered.length}{" "}
              {filtered.length === 1 ? "body of work" : "bodies of work"}
            </p>
            <h2 id="work-index-title">
              {query.query
                ? `Results for “${query.query}”`
                : "Complete grouped index"}
            </h2>
          </div>
          <span>
            Page {page} of {pageCount}
          </span>
        </header>

        <ol
          className={styles.workList}
          start={(page - 1) * perPage + 1}
        >
          {pageWorks.map((work) => {
            const matchingChild = matchingChildForQuery(work, query.query);
            return (
              <li key={work.id}>
                <Link
                  className={styles.workRow}
                  href={`/work/${work.slug}${
                    matchingChild ? `#${matchingChild.id}` : ""
                  }`}
                >
                  <span className={styles.year}>{work.year ?? "Undated"}</span>
                  <span className={styles.workTitle}>
                    <strong>{work.title}</strong>
                    {matchingChild ? (
                      <small>
                        Matched public record: {matchingChild.displayTitle}
                      </small>
                    ) : (
                      <small>
                        {work.role}
                        {work.bucket
                          ? ` · ${
                              workBuckets.find(
                                (bucket) => bucket.id === work.bucket,
                              )?.shortTitle ?? ""
                            }`
                          : ""}
                      </small>
                    )}
                  </span>
                  <span className={styles.workMeta}>
                    {work.formats
                      .slice(0, 2)
                      .map(humanizeWorkFilter)
                      .join(" · ")}
                    {work.formCount > 1
                      ? ` · ${work.formCount} nested forms`
                      : " · 1 public form"}
                  </span>
                  <i aria-hidden="true">↗</i>
                </Link>
              </li>
            );
          })}
        </ol>

        {!pageWorks.length ? (
          <div className={styles.empty}>
            <p>No work matches those filters.</p>
            <Link href="/work">Clear the search</Link>
          </div>
        ) : null}

        {pageCount > 1 ? (
          <nav className={styles.pagination} aria-label="Archive pages">
            {page > 1 ? (
              <Link href={workArchiveHref(query, { page: page - 1 })}>
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span>
              {(page - 1) * perPage + 1}—
              {Math.min(page * perPage, filtered.length)} of {filtered.length}
            </span>
            {page < pageCount ? (
              <Link href={workArchiveHref(query, { page: page + 1 })}>
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </main>
  );
}

function FilterSelect({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className={styles.select}>
      <span>{label}</span>
      <select defaultValue={value} name={name}>
        <option value="">
          {label === "Body"
            ? "All bodies"
            : `All ${label.toLocaleLowerCase()}s`}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
