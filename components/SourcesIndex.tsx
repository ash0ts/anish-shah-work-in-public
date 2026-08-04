import Link from "next/link";
import { FilteredResultFocus } from "@/components/FilteredResultFocus";
import { isKnownUnavailablePublicUrl } from "@/lib/public-url-health";
import type { EvidenceSource } from "@/types/content";
import styles from "./SourcesIndex.module.css";
import { SITE_COPY } from "@/lib/copy";

type LinkedContext = {
  id: string;
  label: string;
  href: string;
};

type SourceIndexEntry = {
  source: EvidenceSource;
  linkedWork: LinkedContext[];
  linkedClaims: LinkedContext[];
};

export function SourcesIndex({
  entries,
  query = "",
  kind = "all",
  association = "all",
  page = 1,
}: {
  entries: SourceIndexEntry[];
  query?: string;
  kind?: string;
  association?: string;
  page?: number;
}) {
  const kinds = [...new Set(entries.map(({ source }) => source.kind))].sort();
  const selectedKind = kinds.some((value) => value === kind) ? kind : "all";
  const selectedAssociation = ["all", "work", "claim"].includes(association)
    ? association
    : "all";
  const needle = query.trim().toLowerCase();
  const filtered = entries.filter(
    ({ source, linkedWork, linkedClaims }) =>
      (selectedKind === "all" || source.kind === selectedKind) &&
      (selectedAssociation === "all" ||
        (selectedAssociation === "work" && linkedWork.length > 0) ||
        (selectedAssociation === "claim" && linkedClaims.length > 0)) &&
      (!needle ||
        [
          source.title,
          source.publisher,
          source.kind,
          ...linkedWork.map((entry) => entry.label),
          ...linkedClaims.map((entry) => entry.label),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)),
  );
  const isFiltering =
    Boolean(needle) ||
    selectedKind !== "all" ||
    selectedAssociation !== "all";
  const perPage = 24;
  const pageCount = Math.max(Math.ceil(filtered.length / perPage), 1);
  const selectedPage = Math.min(Math.max(page, 1), pageCount);
  const startIndex = (selectedPage - 1) * perPage;
  const visibleEntries = filtered.slice(startIndex, startIndex + perPage);

  return (
    <section
      className={styles.index}
      aria-labelledby="source-index-title"
      id="bibliography"
    >
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{SITE_COPY.sources["bibliography-eyebrow"]}</p>
          <h2 id="source-index-title" tabIndex={-1}>
            {entries.length} sources, open to inspect.
          </h2>
        </div>
        <form
          action="/sources#bibliography"
          className={styles.filters}
          method="get"
        >
          <label>
            <span>{SITE_COPY.sources["bibliography-search-label"]}</span>
            <input
              defaultValue={query}
              name="q"
              type="search"
              placeholder={SITE_COPY.sources["bibliography-search-placeholder"]}
            />
          </label>
          <label>
            <span>Evidence type</span>
            <select defaultValue={selectedKind} name="kind">
              <option value="all">All evidence</option>
              {kinds.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Association</span>
            <select defaultValue={selectedAssociation} name="association">
              <option value="all">All associations</option>
              <option value="work">Linked to work</option>
              <option value="claim">Linked to a claim</option>
            </select>
          </label>
          <button type="submit">Search</button>
          {isFiltering ? (
            <Link
              className={styles.clear}
              href="/sources#bibliography"
              prefetch={false}
            >
              Clear
            </Link>
          ) : null}
        </form>
      </div>
      <FilteredResultFocus
        active={isFiltering || selectedPage > 1}
        targetId="source-index-title"
      />
      <div
        aria-atomic="true"
        aria-live="polite"
        className={styles.count}
        role="status"
      >
        <span>
          {isFiltering
            ? `${filtered.length} matching public sources`
            : `${filtered.length} public sources`}
        </span>
        <span>
          {filtered.length
            ? `${startIndex + 1}—${Math.min(
                startIndex + perPage,
                filtered.length,
              )} shown`
            : "No matches"}
        </span>
      </div>
      <SourceRows entries={visibleEntries} startIndex={startIndex} />
      {pageCount > 1 ? (
        <nav className={styles.pagination} aria-label="Bibliography pages">
          {selectedPage > 1 ? (
            <Link
              prefetch={false}
              href={sourceIndexHref(
                query,
                selectedKind,
                selectedAssociation,
                selectedPage - 1,
              )}
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
              prefetch={false}
              href={sourceIndexHref(
                query,
                selectedKind,
                selectedAssociation,
                selectedPage + 1,
              )}
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}

function sourceIndexHref(
  query: string,
  kind: string,
  association: string,
  page: number,
) {
  const parameters = new URLSearchParams();
  if (query.trim()) parameters.set("q", query.trim());
  if (kind !== "all") parameters.set("kind", kind);
  if (association !== "all") parameters.set("association", association);
  if (page > 1) parameters.set("page", String(page));
  const suffix = parameters.toString();
  return `${suffix ? `/sources?${suffix}` : "/sources"}#bibliography`;
}

function SourceRows({
  entries,
  startIndex = 0,
}: {
  entries: SourceIndexEntry[];
  startIndex?: number;
}) {
  return (
    <ol className={styles.list} start={startIndex + 1}>
      {entries.map(({ source, linkedWork, linkedClaims }, index) => {
        const context = [...linkedClaims, ...linkedWork];
        return (
          <li id={source.id} key={source.id}>
            <span>{String(startIndex + index + 1).padStart(3, "0")}</span>
            <div>
              <strong>{source.title}</strong>
              <small>
                {source.kind.replaceAll("_", " ")}
                {source.publisher ? ` · ${source.publisher}` : ""}
              </small>
              {context.length ? (
                <small className={styles.context}>
                  Supports{" "}
                  {context.slice(0, 2).map((entry, contextIndex) => (
                    <span key={entry.id}>
                      {contextIndex ? " · " : ""}
                      <Link href={entry.href} prefetch={false}>
                        {entry.label}
                      </Link>
                    </span>
                  ))}
                  {context.length > 2 ? ` · +${context.length - 2} more` : ""}
                </small>
              ) : null}
            </div>
            {source.url && !isKnownUnavailablePublicUrl(source.url) ? (
              <a href={source.url} rel="noreferrer" target="_blank">
                Open ↗
              </a>
            ) : source.url ? (
              <i>Indexed · host unavailable</i>
            ) : (
              <i>Method note</i>
            )}
          </li>
        );
      })}
    </ol>
  );
}
