import type { WorkArchiveRecord } from "@/lib/work-index";

export type WorkSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type WorkArchiveQuery = {
  query: string;
  topic: string;
  year: string;
  format: string;
  organization: string;
  role: string;
  practice: string;
  page: number;
};

type WorkArchiveQueryPatch = Partial<
  Record<
    "q" | "topic" | "year" | "format" | "organization" | "role" | "practice" | "page",
    string | number | null
  >
>;

const queryParameterOrder = [
  "q",
  "topic",
  "year",
  "format",
  "organization",
  "role",
  "practice",
  "page",
] as const;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function parseWorkArchiveQuery(
  params: WorkSearchParams,
): WorkArchiveQuery {
  const parsedPage = Number.parseInt(first(params.page), 10);
  return {
    query: first(params.q).trim(),
    topic: first(params.topic),
    year: first(params.year),
    format: first(params.format),
    organization: first(params.organization),
    role: first(params.role),
    // Retained only so old bookmarked practice URLs keep working.
    practice: first(params.practice),
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
}

function queryEntries(query: WorkArchiveQuery) {
  return {
    q: query.query,
    topic: query.topic,
    year: query.year,
    format: query.format,
    organization: query.organization,
    role: query.role,
    practice: query.practice,
    page: query.page === 1 ? "" : String(query.page),
  };
}

export function workArchiveHref(
  query: WorkArchiveQuery,
  patch: WorkArchiveQueryPatch = {},
): string {
  const values: Record<(typeof queryParameterOrder)[number], string> = {
    ...queryEntries(query),
  };
  for (const [key, value] of Object.entries(patch)) {
    if (!(queryParameterOrder as readonly string[]).includes(key)) continue;
    values[key as keyof typeof values] =
      value === null || value === "" ? "" : String(value);
  }

  const parameters = new URLSearchParams();
  for (const key of queryParameterOrder) {
    if (values[key]) parameters.set(key, values[key]);
  }
  const suffix = parameters.toString();
  return suffix ? `/work?${suffix}` : "/work";
}

export function legacyMapRedirectPath(
  params: WorkSearchParams,
): string | null {
  if (first(params.view) !== "map") return null;
  return workArchiveHref(parseWorkArchiveQuery(params));
}

function parentSearchText(work: WorkArchiveRecord): string {
  return normalized(
    [
      work.title,
      work.summary ?? "",
      work.role,
      work.kind,
      ...work.formats,
      ...work.topics,
      ...work.organizationNames,
      ...work.searchAliases,
    ].join(" "),
  );
}

function childSearchText(child: WorkArchiveRecord["childItems"][number]) {
  return normalized(
    [
      child.title,
      child.displayTitle,
      child.shortTitle,
      child.slug,
      child.role,
      child.type,
      ...child.aliases,
    ].join(" "),
  );
}

export function matchingChildForQuery(
  work: WorkArchiveRecord,
  rawQuery: string,
): WorkArchiveRecord["childItems"][number] | undefined {
  const needle = normalized(rawQuery);
  if (!needle) return undefined;
  const exactChild = work.childItems.find((child) =>
    [child.slug, ...child.aliases].some(
      (alias) => normalized(alias) === needle,
    ),
  );
  if (exactChild) return exactChild;
  if (parentSearchText(work).includes(needle)) return undefined;
  return work.childItems.find((child) =>
    childSearchText(child).includes(needle),
  );
}

export function filterWorkArchiveRecords(
  records: WorkArchiveRecord[],
  query: WorkArchiveQuery,
): WorkArchiveRecord[] {
  const needle = normalized(query.query);
  return records.filter((work) => {
    const searchMatches =
      !needle ||
      parentSearchText(work).includes(needle) ||
      work.childItems.some((child) => childSearchText(child).includes(needle));
    return (
      searchMatches &&
      (!query.topic || work.topics.includes(query.topic)) &&
      (!query.year || String(work.year ?? "undated") === query.year) &&
      (!query.format || work.formats.includes(query.format)) &&
      (!query.organization ||
        work.organizationIds.includes(query.organization)) &&
      (!query.role || work.role === query.role) &&
      (!query.practice || work.practice === query.practice)
    );
  });
}

export function humanizeWorkFilter(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\p{L}/gu, (character) => character.toLocaleUpperCase());
}
