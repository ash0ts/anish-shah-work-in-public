import publicBundleJson from "../../content/public/anish-content.public.v1.json" with {
  type: "json",
};
import type {
  AnishContentBundle,
  EvidenceSource,
  PortfolioItem,
  PublicImpactMetric,
  Relation,
} from "../../types/content";
export {
  collectionMetricsFrom,
  entitiesOfKindFrom,
  entityForItemFrom,
  findEntityBySlugFrom,
  findItemBySlugFrom,
  itemsForEntityFrom,
  metricsForItemFrom,
  supplementalWorkEntriesFrom,
  workIndexEntriesFrom,
} from "../content-selectors";
import {
  runtimeDatabase,
  runtimePublicationKv,
  runtimeValue,
} from "./runtime-env";
import {
  resolvePublicContentFromSnapshotRow,
  resolveVerifiedPublicContentFromSnapshotRow,
  type PublishedSnapshotRow,
  type ResolvedPublicContent,
} from "./public-content-selector";
import { readPublicationFallback } from "./publication-fallback";
import { previewFixtureRuntime } from "../deployment-environment";
import { applyCopyDeckToBundle } from "../copy";
export { PUBLICATION_FALLBACK_KEY } from "./publication-fallback";

// Apply Git-owned presentation copy before D1 visibility/order/caveat merging.
// This preserves owner-controlled caveats while making retained WorkGroup
// wording non-authoritative everywhere, including KV recovery.
const staticPublicBundle = applyCopyDeckToBundle(
  publicBundleJson as AnishContentBundle,
);

export class PublicContentUnavailableError extends Error {
  constructor() {
    super("The current public publication could not be verified.");
    this.name = "PublicContentUnavailableError";
  }
}

async function resolveKvFallback(
  fallbackStore: KVNamespace | null,
): Promise<ResolvedPublicContent | null> {
  if (!fallbackStore) return null;
  try {
    const row = await readPublicationFallback(fallbackStore);
    return row
      ? resolveVerifiedPublicContentFromSnapshotRow(staticPublicBundle, row)
      : null;
  } catch {
    return null;
  }
}

export async function getPublicContentViewFromStores(
  database: D1Database | null,
  fallbackStore: KVNamespace | null,
  options: { failClosed: boolean },
): Promise<ResolvedPublicContent> {
  if (!database) {
    if (options.failClosed) {
      const fallback = await resolveKvFallback(fallbackStore);
      if (fallback) return fallback;
      throw new PublicContentUnavailableError();
    }
    return resolvePublicContentFromSnapshotRow(staticPublicBundle, null);
  }

  let row: PublishedSnapshotRow | null;
  try {
    row = await database
      .prepare(
        `SELECT snapshots.snapshot_json AS snapshotJson,
                snapshots.content_hash AS contentHash
         FROM editorial_settings AS settings
         JOIN publication_snapshots AS snapshots
           ON snapshots.id = json_extract(settings.value_json, '$.snapshotId')
         WHERE settings.key = 'publication.current'
         LIMIT 1`,
      )
      .first<PublishedSnapshotRow>();
  } catch {
    const fallback = await resolveKvFallback(fallbackStore);
    if (fallback) return fallback;
    if (options.failClosed) throw new PublicContentUnavailableError();
    return resolvePublicContentFromSnapshotRow(staticPublicBundle, null);
  }

  if (!row) {
    if (options.failClosed) throw new PublicContentUnavailableError();
    return resolvePublicContentFromSnapshotRow(staticPublicBundle, null);
  }

  const verified = await resolveVerifiedPublicContentFromSnapshotRow(
    staticPublicBundle,
    row,
  );
  if (verified) return verified;

  const fallback = await resolveKvFallback(fallbackStore);
  if (fallback) return fallback;
  if (options.failClosed) throw new PublicContentUnavailableError();
  return resolvePublicContentFromSnapshotRow(staticPublicBundle, null);
}

export async function getPublicContentView(): Promise<ResolvedPublicContent> {
  const runtime = {
    DEPLOYMENT_TIER: runtimeValue("DEPLOYMENT_TIER"),
    PREVIEW_PR_NUMBER: runtimeValue("PREVIEW_PR_NUMBER"),
    SITE_URL: runtimeValue("SITE_URL"),
    PRODUCTION_SITE_URL: runtimeValue("PRODUCTION_SITE_URL"),
    PUBLIC_CONTENT_MODE: runtimeValue("PUBLIC_CONTENT_MODE"),
    RELEASE_VERSION: runtimeValue("RELEASE_VERSION"),
  };
  if (previewFixtureRuntime(runtime)) {
    return await resolvePublicContentFromSnapshotRow(
      staticPublicBundle,
      null,
    );
  }
  const failClosed =
    runtimeValue("PUBLIC_CONTENT_MODE") === "d1_kv_required" ||
    runtimeValue("AUTH_MODE") === "cloudflare_access";
  return await getPublicContentViewFromStores(
    runtimeDatabase(),
    runtimePublicationKv(),
    { failClosed },
  );
}

export function publicMetricsFrom(
  bundle: AnishContentBundle,
): PublicImpactMetric[] {
  return bundle.metrics.filter(
    (metric): metric is PublicImpactMetric =>
      "displayValue" in metric && metric.publicationState === "public",
  );
}

export function featuredItemsFrom(
  bundle: AnishContentBundle,
  limit = 6,
  preserveOrder = false,
): PortfolioItem[] {
  const published = bundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const featured = published.filter((item) => item.featured);
  const candidates = featured.length ? featured : published;
  const ordered = preserveOrder
    ? candidates
    : [...candidates].sort(
        (left, right) =>
          (right.date.start ?? "").localeCompare(left.date.start ?? "") ||
          right.title.localeCompare(left.title),
      );
  return ordered.slice(0, limit);
}

export function organizationNamesFrom(
  bundle: AnishContentBundle,
  item: PortfolioItem,
): string[] {
  const organizations = new Map(
    bundle.organizations.map((organization) => [
      organization.id,
      organization.name,
    ]),
  );
  return item.organizationIds
    .map((id) => organizations.get(id))
    .filter((name): name is string => Boolean(name));
}

export function evidenceForItemFrom(
  bundle: AnishContentBundle,
  item: PortfolioItem,
): EvidenceSource[] {
  const evidence = new Map(
    bundle.evidence.map((source) => [source.id, source]),
  );
  return item.evidenceIds
    .map((id) => evidence.get(id))
    .filter(
      (source): source is EvidenceSource =>
        Boolean(source && source.access === "public_web"),
    );
}

export function relatedItemsFrom(
  bundle: AnishContentBundle,
  item: PortfolioItem,
): Array<{ item: PortfolioItem; relation: Relation; direction: "from" | "to" }> {
  return bundle.relations
    .filter(
      (relation) => relation.fromId === item.id || relation.toId === item.id,
    )
    .flatMap((relation) => {
      const direction = relation.fromId === item.id ? "from" : "to";
      const relatedId =
        direction === "from" ? relation.toId : relation.fromId;
      const relatedItem = bundle.items.find(
        (candidate) =>
          candidate.id === relatedId && candidate.publicationState === "public",
      );
      return relatedItem
        ? [{ item: relatedItem, relation, direction } as const]
        : [];
    });
}
