"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isKnownUnavailablePublicUrl } from "@/lib/public-url-health";
import type { EvidenceSource } from "@/types/content";

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

export function SourcesIndex({ entries }: { entries: SourceIndexEntry[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const kinds = useMemo(
    () => [...new Set(entries.map(({ source }) => source.kind))].sort(),
    [entries],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(
      ({ source, linkedWork, linkedClaims }) =>
        (kind === "all" || source.kind === kind) &&
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
  }, [entries, kind, query]);

  return (
    <section className="source-index" aria-labelledby="source-index-title">
      <div className="source-index-heading">
        <div>
          <p className="utility-label">Public bibliography</p>
          <h2 id="source-index-title">{entries.length} sources, open to inspect.</h2>
        </div>
        <div className="source-filters">
          <label>
            <span>Search sources</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Work, claim, publisher, title…"
            />
          </label>
          <label>
            <span>Evidence type</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="all">All evidence</option>
              {kinds.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="source-count" aria-live="polite">
        {filtered.length} matching public sources
      </div>
      <ol className="source-list">
        {filtered.map(({ source, linkedWork, linkedClaims }, index) => {
          const context = [...linkedClaims, ...linkedWork];
          return (
          <li key={source.id}>
            <span>{String(index + 1).padStart(3, "0")}</span>
            <div>
              <strong>{source.title}</strong>
              <small>
                {source.kind.replaceAll("_", " ")}
                {source.publisher ? ` · ${source.publisher}` : ""}
              </small>
              {context.length ? (
                <small className="source-context">
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
    </section>
  );
}
