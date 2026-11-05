import { getPublicContentView } from "../../public-content";
import { getPublicConnectorSnapshot } from "../../connectors/repository";
import { personalInternetFrom } from "./workspace";
import { verifiedGooglePermissions } from "./permissions";
import { conversationSourceAllowed } from "./screening";
import { conversationDatabase } from "./settings";
import {
  pageCatalog,
  type CatalogDomain,
  type CatalogPage,
  type Discovery,
} from "@/lib/simulation/network/catalog-contract";

const routes = {
  myanimelist: "watch",
  hardcover: "read",
  steam: "play",
  spotify: "listen",
  discogs: "collect",
} as const;
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const safe = (v: unknown, max = 200) =>
  typeof v === "string" && v.length <= max && conversationSourceAllowed(v)
    ? v
    : "";
async function hash(value: unknown) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
  return Array.from(bytes.slice(0, 12), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Exact projection from an already accepted/public snapshot. No profile IDs or artwork. */
export async function projectSavedDiscoveries(
  domain: Exclude<CatalogDomain, "work">,
  payload: Record<string, unknown>,
  stale: boolean,
): Promise<Discovery[]> {
  const updatedAt =
    typeof payload.syncedAt === "string" &&
    Number.isFinite(Date.parse(payload.syncedAt))
      ? payload.syncedAt
      : null;
  const version = await hash(payload);
  const window = object(object(payload.windows).short_term);
  const raw = domain === "spotify" ? window.tracks : payload.library;
  const rows = Array.isArray(raw) ? raw : [];
  const result: Discovery[] = [];
  for (const raw of rows) {
    const row = object(raw),
      title = safe(row.title);
    if (!title) continue;
    const metadata: string[] = [];
    const topics: Discovery["topics"] = [];
    if (domain === "myanimelist" && Array.isArray(row.genres))
      for (const genre of row.genres) {
        const label = safe(genre, 60);
        if (label) topics.push({ id: `genre:${label.toLowerCase()}`, label });
      }
    if (domain === "spotify" || domain === "discogs") {
      const artists = Array.isArray(row.artists)
        ? row.artists.flatMap(
            (v) => safe(typeof v === "string" ? v : object(v).name, 120) || [],
          )
        : [];
      if (artists.length) metadata.push(artists.slice(0, 6).join(", "));
      for (const name of artists)
        topics.push({ id: `artist:${name.toLowerCase()}`, label: name });
    }
    if (
      domain === "steam" &&
      typeof row.totalHoursRounded === "number" &&
      Number.isFinite(row.totalHoursRounded)
    )
      metadata.push(`${Math.round(row.totalHoursRounded)} hours (rounded)`);
    if (
      (domain === "hardcover" || domain === "myanimelist") &&
      safe(row.status, 60)
    )
      metadata.push(safe(row.status, 60));
    if (topics.length && domain === "myanimelist")
      metadata.push(topics.map((t) => t.label).join(", "));
    const limit =
      domain === "spotify"
        ? "Spotify-calculated short-term affinity, not play counts or listening history. Game effects are fictional."
        : "Saved collection metadata, not a statement of preference or influence. Game effects are fictional.";
    const id = `saved:${domain}:${version}:${await hash([row.id ?? row.appId ?? row.releaseId ?? title, title])}`;
    if (result.some((item) => item.id === id)) continue;
    result.push({
      id,
      title,
      domain,
      version,
      updatedAt,
      stale,
      topics,
      text: metadata.join(" · ") || "Saved collection item.",
      limit,
      href: `/play/${routes[domain]}`,
      period: updatedAt,
      citations: [],
      provenance: domain,
    });
  }
  return result;
}

export async function readSimulationCatalog(
  domain: CatalogDomain,
  q = "",
  page = 1,
  purpose: "game_display" | "google_gemini_processing" = "game_display",
  ids?: string[],
): Promise<CatalogPage> {
  if (domain === "work") {
    const { bundle } = await getPublicContentView();
    const { catalog, featuredIds } = personalInternetFrom(bundle);
    catalog.sort(
      (a, b) =>
        Number(featuredIds.includes(b.id)) - Number(featuredIds.includes(a.id)),
    );
    const items: Discovery[] = await Promise.all(
      catalog.map(async (item) => ({
        ...item,
        domain: "work" as const,
        version: await hash(item),
        updatedAt: null,
        stale: false,
        provenance: "Visible Work archive",
      })),
    );
    return pageCatalog(
      ids ? items.filter((item) => ids.includes(item.id)) : items,
      domain,
      q,
      page,
    );
  }
  const empty = {
    ...pageCatalog([], domain, q, page),
    status: "permission_required" as const,
  };
  const allowed = await verifiedGooglePermissions(
    conversationDatabase(),
    purpose,
  );
  if (!allowed.includes(domain)) return empty;
  // Google processing also requires permission to display the item in this game.
  if (
    purpose === "google_gemini_processing" &&
    !(
      await verifiedGooglePermissions(conversationDatabase(), "game_display")
    ).includes(domain)
  )
    return empty;
  const snapshot = await getPublicConnectorSnapshot(domain);
  if (snapshot.status !== "ready") return { ...empty, status: "unavailable" };
  const items = await projectSavedDiscoveries(
    domain,
    snapshot.payload as unknown as Record<string, unknown>,
    snapshot.stale,
  );
  return pageCatalog(
    ids ? items.filter((item) => ids.includes(item.id)) : items,
    domain,
    q,
    page,
  );
}

/** Resolve only requested versioned IDs, never export whole collection contents. */
export async function resolveSavedSources(ids: readonly string[]) {
  const domains = [
    ...new Set(
      ids.flatMap((id) => {
        const match =
          /^saved:(myanimelist|hardcover|spotify|discogs|steam):/.exec(id);
        return match ? [match[1] as Exclude<CatalogDomain, "work">] : [];
      }),
    ),
  ];
  const sources: Discovery[] = [];
  for (const domain of domains) {
    if (
      !(
        await verifiedGooglePermissions(conversationDatabase(), "game_display")
      ).includes(domain) ||
      !(await verifiedGooglePermissions()).includes(domain)
    )
      continue;
    const snapshot = await getPublicConnectorSnapshot(domain);
    if (snapshot.status !== "ready") continue;
    sources.push(
      ...(
        await projectSavedDiscoveries(
          domain,
          snapshot.payload as unknown as Record<string, unknown>,
          snapshot.stale,
        )
      ).filter((item) => ids.includes(item.id)),
    );
  }
  return sources;
}
