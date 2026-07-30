import type { Metadata } from "next";
import Link from "next/link";
import { VisualArchive } from "@/components/VisualArchive";
import { getPublicContentView } from "@/lib/server/public-content";
import { workArchiveRecordsFrom } from "@/lib/work-index";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Work",
  description:
    "A searchable index of Anish Shah’s applied AI products, courses, writing, open-source work, talks, and public forms.",
};

type WorkSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<WorkSearchParams>;
}) {
  const [params, { bundle }] = await Promise.all([
    searchParams,
    getPublicContentView(),
  ]);
  const query = first(params.q).trim();
  const practice = first(params.practice);
  const year = first(params.year);
  const format = first(params.format);
  const organization = first(params.organization);
  const role = first(params.role);
  const view = first(params.view) === "map" ? "map" : "index";
  const requestedPage = Math.max(Number.parseInt(first(params.page) || "1", 10), 1);
  const allWorks = workArchiveRecordsFrom(bundle).sort(
    (left, right) =>
      (right.year ?? -1) - (left.year ?? -1) ||
      left.title.localeCompare(right.title),
  );
  const needle = query.toLocaleLowerCase();
  const filtered = allWorks.filter((work) => {
    const searchText = [
      work.title,
      work.summary ?? "",
      work.role,
      work.kind,
      ...work.formats,
      ...work.topics,
      ...work.organizationNames,
      ...work.childTitles,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      (!needle || searchText.includes(needle)) &&
      (!practice || work.practice === practice) &&
      (!year || String(work.year ?? "undated") === year) &&
      (!format || work.formats.includes(format)) &&
      (!organization || work.organizationIds.includes(organization)) &&
      (!role || work.role === role)
    );
  });

  const perPage = 24;
  const pageCount = Math.max(Math.ceil(filtered.length / perPage), 1);
  const page = Math.min(requestedPage, pageCount);
  const pageWorks = filtered.slice((page - 1) * perPage, page * perPage);
  const organizationNames = new Map(
    bundle.organizations.map((entry) => [entry.id, entry.name]),
  );
  const entitySlugById = new Map(
    bundle.entities.map((entity) => [entity.id, entity.slug]),
  );
  const publicForms = bundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const options = {
    years: [
      ...new Set(allWorks.map((work) => work.year ?? "undated")),
    ].sort((a, b) =>
      a === "undated" ? 1 : b === "undated" ? -1 : Number(b) - Number(a),
    ),
    formats: [...new Set(allWorks.flatMap((work) => work.formats))].sort(),
    organizations: [
      ...new Set(allWorks.flatMap((work) => work.organizationIds)),
    ]
      .map((id) => ({ id, name: organizationNames.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    roles: [...new Set(allWorks.map((work) => work.role).filter(Boolean))].sort(),
  };

  const linkFor = (next: Record<string, string | number | null>) => {
    const url = new URLSearchParams();
    const current = { query, practice, year, format, organization, role, view };
    Object.entries(current).forEach(([key, value]) => {
      const parameter = key === "query" ? "q" : key;
      if (value && !(parameter === "view" && value === "index")) {
        url.set(parameter, value);
      }
    });
    Object.entries(next).forEach(([key, value]) => {
      if (value === null || value === "" || (key === "view" && value === "index")) {
        url.delete(key);
      } else {
        url.set(key, String(value));
      }
    });
    const suffix = url.toString();
    return suffix ? `/work?${suffix}` : "/work";
  };

  return (
    <main id="main" className="site-main v11-work-page">
      <header
        className={`v11-index-head${view === "map" ? " v11-index-head-map" : ""}`}
      >
        <div>
          <p className="utility-label">Public work · 2021—now</p>
          <h1>One body of work. Many public forms.</h1>
        </div>
        <p>
          Search the canonical work first. Recordings, translations, mirrors,
          repositories, pull requests, and event occurrences stay attached
          without pretending to be separate achievements.
        </p>
      </header>

      <section className="v11-work-tools" aria-labelledby="work-search-title">
        <div className="v11-view-switch" aria-label="Archive view">
          <Link aria-current={view === "index" ? "page" : undefined} href={linkFor({ view: "index", page: null })}>
            Index
          </Link>
          <Link aria-current={view === "map" ? "page" : undefined} href={linkFor({ view: "map", page: null })}>
            Map <span>loads 3D</span>
          </Link>
        </div>

        <form action="/work" method="get">
          {view === "map" ? <input name="view" type="hidden" value="map" /> : null}
          <label className="v11-search">
            <span id="work-search-title">Search work and public forms</span>
            <input
              defaultValue={query}
              name="q"
              placeholder="Agents, evaluation, MCP, Microsoft…"
              type="search"
            />
          </label>
          <label>
            <span>Year</span>
            <select defaultValue={year} name="year">
              <option value="">All years</option>
              {options.years.map((value) => (
                <option key={value} value={value}>
                  {value === "undated" ? "Undated" : value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Format</span>
            <select defaultValue={format} name="format">
              <option value="">All formats</option>
              {options.formats.map((value) => (
                <option key={value} value={value}>{label(value)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Organization</span>
            <select defaultValue={organization} name="organization">
              <option value="">All organizations</option>
              {options.organizations.map((value) => (
                <option key={value.id} value={value.id}>{value.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Role</span>
            <select defaultValue={role} name="role">
              <option value="">All roles</option>
              {options.roles.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <button type="submit">Apply filters</button>
        </form>

        <nav className="v11-practice-presets" aria-label="Practice filters">
          {(["teach", "build", "convene"] as const).map((value) => (
            <Link
              aria-current={practice === value ? "page" : undefined}
              href={linkFor({
                practice: practice === value ? null : value,
                page: null,
              })}
              key={value}
            >
              {value}
            </Link>
          ))}
          <Link href={view === "map" ? "/work?view=map" : "/work"}>Clear</Link>
        </nav>
      </section>

      {view === "map" ? <VisualArchive works={filtered} /> : null}

      <section className="v11-work-index" aria-labelledby="work-index-title">
        <header>
          <div>
            <p className="utility-label">
              {filtered.length} canonical {filtered.length === 1 ? "work" : "works"}
            </p>
            <h2 id="work-index-title">
              {query ? `Results for “${query}”` : "The chronological index."}
            </h2>
          </div>
          <span>Page {page} / {pageCount}</span>
        </header>

        <ol start={(page - 1) * perPage + 1}>
          {pageWorks.map((work) => {
            const matchingChild =
              needle &&
              work.childItems.find((child) =>
                `${child.title} ${child.role} ${child.type}`
                  .toLocaleLowerCase()
                  .includes(needle),
              );
            return (
              <li key={work.id}>
                <Link href={`/work/${work.slug}${matchingChild ? `#${matchingChild.id}` : ""}`}>
                  <span>{work.year ?? "Undated"}</span>
                  <span>{work.practice}</span>
                  <strong>{work.title}</strong>
                  <span>
                    {work.formCount} {work.formCount === 1 ? "form" : "forms"}
                    {matchingChild ? ` · matched ${matchingChild.type.replaceAll("_", " ")}` : ""}
                  </span>
                  <i aria-hidden="true">↗</i>
                </Link>
              </li>
            );
          })}
        </ol>

        {!pageWorks.length ? (
          <div className="v11-work-empty">
            <p>No canonical work matches those filters.</p>
            <Link href={view === "map" ? "/work?view=map" : "/work"}>
              Clear the search
            </Link>
          </div>
        ) : null}

        {pageCount > 1 ? (
          <nav className="v11-pagination" aria-label="Archive pages">
            {page > 1 ? <Link href={linkFor({ page: page - 1 })}>← Previous</Link> : <span />}
            <span>{(page - 1) * perPage + 1}—{Math.min(page * perPage, filtered.length)} of {filtered.length}</span>
            {page < pageCount ? <Link href={linkFor({ page: page + 1 })}>Next →</Link> : <span />}
          </nav>
        ) : null}

        <details className="v11-all-forms">
          <summary>Browse all {publicForms.length} public forms</summary>
          <p>
            Source observations remain openable even when several forms belong
            to the same canonical work.
          </p>
          <ol>
            {publicForms.map((item) => {
              const entitySlug = entitySlugById.get(item.canonicalEntityId);
              if (!entitySlug) return null;
              return (
                <li key={item.id}>
                  <Link href={`/work/${entitySlug}#${item.id}`}>
                    <span>{item.year ?? "Undated"} · {label(item.type)}</span>
                    <strong>{item.displayTitle}</strong>
                  </Link>
                </li>
              );
            })}
          </ol>
        </details>
      </section>
    </main>
  );
}
