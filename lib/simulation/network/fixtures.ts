import {
  pageCatalog,
  type CatalogDomain,
  type Discovery,
} from "./catalog-contract";
/** Synthetic preview only: invented test titles, never represented as owner data. */
export function fixtureCatalog(domain: CatalogDomain, query = "", page = 1) {
  const routes = {
    work: "/work",
    myanimelist: "/play/watch",
    hardcover: "/play/read",
    steam: "/play/play",
    spotify: "/play/listen",
    discogs: "/play/collect",
  };
  const titles = [
    "Amber circuit",
    "The spare moon",
    "Return to sender",
    "Signal garden",
    "Pocket observatory",
    "Soft reset",
  ];
  const items: Discovery[] = Array.from({ length: 26 }, (_, i) => ({
    id: `fixture:${domain}:${i}`,
    domain,
    version: "fixture-v1",
    title: `Fixture · ${titles[i % titles.length]} ${i + 1}`,
    text: "Invented sample for layout testing. Not an item in the owner's collection.",
    limit:
      domain === "spotify"
        ? "Fixture of Spotify affinity metadata, not play counts. No provider or model was contacted."
        : "Synthetic fixture, not owner data. No provider or model was contacted.",
    href: routes[domain],
    period: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    stale: true,
    citations: [],
    provenance: "Labelled synthetic fixture",
    topics: [],
  }));
  return { ...pageCatalog(items, domain, query, page), fixture: true };
}
