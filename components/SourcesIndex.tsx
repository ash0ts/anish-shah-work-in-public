import Link from "next/link";
import { isKnownUnavailablePublicUrl } from "@/lib/public-url-health";
import type { EvidenceSource } from "@/types/content";
import styles from "./SourcesIndex.module.css";

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
  showAll = false,
}: {
  entries: SourceIndexEntry[];
  query?: string;
  kind?: string;
  showAll?: boolean;
}) {
  const kinds = [...new Set(entries.map(({ source }) => source.kind))].sort();
  const selectedKind = kinds.some((value) => value === kind) ? kind : "all";
  const needle = query.trim().toLowerCase();
  const filtered = entries.filter(
    ({ source, linkedWork, linkedClaims }) =>
      (selectedKind === "all" || source.kind === selectedKind) &&
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
  const isFiltering = Boolean(needle) || selectedKind !== "all";
  const initialLimit = 12;
  const visibleEntries =
    isFiltering || showAll ? filtered : filtered.slice(0, initialLimit);

  return (
    <section
      className={styles.index}
      aria-labelledby="source-index-title"
      id="bibliography"
    >
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Public bibliography</p>
          <h2 id="source-index-title">{entries.length} sources, open to inspect.</h2>
        </div>
        <form action="/sources" className={styles.filters} method="get">
          <label>
            <span>Search sources</span>
            <input
              defaultValue={query}
              name="q"
              type="search"
              placeholder="Work, claim, publisher, title…"
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
          <button type="submit">Search</button>
          {isFiltering ? (
            <Link className={styles.clear} href="/sources#bibliography">
              Clear
            </Link>
          ) : null}
        </form>
      </div>
      <div className={styles.count}>
        {isFiltering
          ? `${filtered.length} matching public sources`
          : showAll
            ? `${filtered.length} public sources · complete bibliography`
            : `${filtered.length} public sources · first ${visibleEntries.length} shown`}
      </div>
      <SourceRows entries={visibleEntries} />
      {!isFiltering && filtered.length > initialLimit ? (
        <div className={styles.browseControls}>
          {showAll ? (
            <Link href="/sources#bibliography">Show the first {initialLimit}</Link>
          ) : (
            <Link href="/sources?sources=all#bibliography">
              Browse all {filtered.length} sources
            </Link>
          )}
          <span>Search uses the complete bibliography.</span>
        </div>
      ) : null}
    </section>
  );
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
          <li key={source.id}>
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
                      <Link href={entry.href}>{entry.label}</Link>
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
