"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Organization, PortfolioItem } from "@/types/content";

type WorkArchiveProps = {
  items: PortfolioItem[];
  organizations: Organization[];
};

function readable(value: string) {
  return value.replaceAll("_", " ");
}

export function WorkArchive({ items, organizations }: WorkArchiveProps) {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("all");
  const [format, setFormat] = useState("all");
  const [topic, setTopic] = useState("all");
  const [organization, setOrganization] = useState("all");
  const [role, setRole] = useState("all");

  const organizationMap = useMemo(
    () => new Map(organizations.map((entry) => [entry.id, entry.name])),
    [organizations],
  );

  const options = useMemo(
    () => ({
      years: [...new Set(items.map((item) => item.year).filter(Boolean))]
        .sort((a, b) => Number(b) - Number(a))
        .map(String),
      formats: [...new Set(items.map((item) => item.type))].sort(),
      topics: [...new Set(items.flatMap((item) => item.topics))].sort(),
      organizations: [...new Set(items.flatMap((item) => item.organizationIds))]
        .map((id) => ({ id, name: organizationMap.get(id) ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      roles: [...new Set(items.map((item) => item.role).filter(Boolean))].sort(),
    }),
    [items, organizationMap],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const searchText = [
        item.title,
        item.role,
        item.type,
        item.location.label,
        ...item.topics,
        ...item.organizationIds.map((id) => organizationMap.get(id) ?? ""),
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!needle || searchText.includes(needle)) &&
        (year === "all" || String(item.year) === year) &&
        (format === "all" || item.type === format) &&
        (topic === "all" || item.topics.includes(topic)) &&
        (organization === "all" || item.organizationIds.includes(organization)) &&
        (role === "all" || item.role === role)
      );
    });
  }, [format, items, organization, organizationMap, query, role, topic, year]);

  const reset = () => {
    setQuery("");
    setYear("all");
    setFormat("all");
    setTopic("all");
    setOrganization("all");
    setRole("all");
  };

  return (
    <section className="archive-browser" aria-labelledby="archive-browser-title">
      <div className="archive-browser-heading">
        <div>
          <p className="utility-label">Every public record</p>
          <h2 id="archive-browser-title">Search the index.</h2>
        </div>
        <p>
          Recordings, mirrors, translations, and references stay visible—but
          their relationships prevent them from inflating unique-work counts.
        </p>
      </div>

      <div className="archive-filters" aria-label="Archive filters">
        <label className="search-field">
          <span>Search</span>
          <input
            type="search"
            placeholder="Agents, evaluation, MLOps…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Year</span>
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="all">All</option>
            {options.years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value)}>
            <option value="all">All</option>
            {options.formats.map((value) => (
              <option key={value} value={value}>
                {readable(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Topic</span>
          <select value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="all">All</option>
            {options.topics.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Organization</span>
          <select
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
          >
            <option value="all">All</option>
            {options.organizations.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="all">All</option>
            {options.roles.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="archive-result-line" aria-live="polite">
        <span>{filtered.length} public records</span>
        <button type="button" onClick={reset}>
          Clear filters
        </button>
      </div>

      <div className="archive-grid">
        {filtered.map((item, index) => {
          const names = item.organizationIds
            .map((id) => organizationMap.get(id))
            .filter(Boolean);
          return (
            <Link
              className={`archive-card archive-card-${(index % 4) + 1}`}
              href={`/work/${item.slug}`}
              key={item.id}
            >
              <span className="archive-card-index">
                {String(index + 1).padStart(3, "0")}
              </span>
              <span className="archive-card-meta">
                {item.year ?? "Date open"} · {readable(item.type)}
              </span>
              <strong>{item.title}</strong>
              <span className="archive-card-role">
                {item.role}
                {names.length ? ` · ${names.slice(0, 2).join(" / ")}` : ""}
              </span>
              <span className="archive-card-topics">
                {item.topics.slice(0, 3).map((itemTopic) => (
                  <i key={itemTopic}>{itemTopic}</i>
                ))}
              </span>
              <span className="archive-card-open" aria-hidden="true">
                ↗
              </span>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="archive-empty">
          <p>No public records match those filters.</p>
          <button type="button" onClick={reset}>
            Show the full index
          </button>
        </div>
      ) : null}
    </section>
  );
}
