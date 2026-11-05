import type { ConversationSource } from "../conversation-contract";
export const CATALOG_DOMAINS = [
  "work",
  "myanimelist",
  "hardcover",
  "steam",
  "spotify",
  "discogs",
] as const;
export type CatalogDomain = (typeof CATALOG_DOMAINS)[number];
export type Discovery = ConversationSource & {
  domain: CatalogDomain;
  version: string;
  updatedAt: string | null;
  stale: boolean;
  topics: Array<{ id: string; label: string }>;
  provenance: string;
};
export type CatalogPage = {
  items: Discovery[];
  domain: CatalogDomain;
  page: number;
  total: number;
  nextPage: number | null;
  status: "ready" | "unavailable" | "permission_required";
  fixture: boolean;
};
export function catalogQuery(url: URL) {
  const domain = url.searchParams.get("domain") ?? "work";
  const q = (url.searchParams.get("q") ?? "").trim();
  const raw = url.searchParams.get("page") ?? "1";
  const ids = url.searchParams.has("ids")
    ? url.searchParams.get("ids")!.split(",")
    : undefined;
  if (
    !CATALOG_DOMAINS.includes(domain as CatalogDomain) ||
    q.length > 80 ||
    /[\u0000-\u001f]/.test(q) ||
    !/^[1-9]\d{0,3}$/.test(raw) ||
    (ids &&
      (ids.length > 24 ||
        ids.some(
          (id) => !/^(?:group:|saved:)[a-zA-Z0-9:_-]{1,120}$/.test(id),
        ))) ||
    [...url.searchParams.keys()].some(
      (k) => url.searchParams.getAll(k).length !== 1,
    ) ||
    [...url.searchParams.keys()].some(
      (k) => !["domain", "q", "page", "ids"].includes(k),
    )
  )
    return null;
  return {
    domain: domain as CatalogDomain,
    q,
    page: Number(raw),
    ...(ids ? { ids } : {}),
  };
}
export function pageCatalog(
  items: Discovery[],
  domain: CatalogDomain,
  q: string,
  page: number,
): CatalogPage {
  const matching = items.filter((item) =>
    `${item.title} ${item.text}`.toLowerCase().includes(q.toLowerCase()),
  );
  return {
    items: matching.slice((page - 1) * 24, page * 24),
    domain,
    page,
    total: matching.length,
    nextPage: page * 24 < matching.length ? page + 1 : null,
    status: "ready",
    fixture: false,
  };
}
