import publicBundleJson from "@/content/public/anish-content.public.v1.json";
import type {
  AnishContentBundle,
  EvidenceSource,
  PortfolioItem,
  PublicImpactMetric,
  Relation,
} from "@/types/content";
import { runtimeDatabase } from "./runtime-env";
import {
  resolvePublicContentFromSnapshotRow,
  type ResolvedPublicContent,
} from "./public-content-selector";

const staticPublicBundle = publicBundleJson as AnishContentBundle;

export async function getPublicContentView(): Promise<ResolvedPublicContent> {
  const database = runtimeDatabase();
  if (!database) {
    return resolvePublicContentFromSnapshotRow(staticPublicBundle, null);
  }

  try {
    const row = await database
      .prepare(
        `SELECT snapshot_json AS snapshotJson, content_hash AS contentHash
         FROM publication_snapshots
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .first<{ snapshotJson: string; contentHash: string }>();
    if (!row) {
      return resolvePublicContentFromSnapshotRow(staticPublicBundle, null);
    }
    return resolvePublicContentFromSnapshotRow(staticPublicBundle, row);
  } catch {
    return resolvePublicContentFromSnapshotRow(staticPublicBundle, null);
  }
}

export function publicMetricsFrom(
  bundle: AnishContentBundle,
): PublicImpactMetric[] {
  return bundle.metrics.filter(
    (metric): metric is PublicImpactMetric =>
      "displayValue" in metric && metric.publicationState === "public",
  );
}

const homepageMetricIds = [
  "metric:courses:enrollments:2026-07-30",
  "metric:project:wandb-mcp-server:tool-calls:2026-06-11",
  "metric:events:pipeline-supported:2025",
];

export function homepageMetricsFrom(
  bundle: AnishContentBundle,
): PublicImpactMetric[] {
  const metrics = publicMetricsFrom(bundle);
  const ids = new Set(homepageMetricIds);
  return metrics.filter((metric) => ids.has(metric.id));
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

export function findItemBySlugFrom(
  bundle: AnishContentBundle,
  slug: string,
): PortfolioItem | undefined {
  return bundle.items.find(
    (item) => item.slug === slug && item.publicationState === "public",
  );
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

export function metricsForItemFrom(
  bundle: AnishContentBundle,
  item: PortfolioItem,
): PublicImpactMetric[] {
  const publicMetrics = publicMetricsFrom(bundle);
  const direct = publicMetrics.filter((metric) => metric.subjectId === item.id);
  const containingCollections = bundle.collections.filter((collection) =>
    collection.itemIds.includes(item.id),
  );
  const collectionMetricIds = new Set(
    containingCollections.flatMap((collection) => collection.metricIds),
  );
  return [
    ...direct,
    ...publicMetrics.filter((metric) => collectionMetricIds.has(metric.id)),
  ].filter(
    (metric, index, all) =>
      all.findIndex((candidate) => candidate.id === metric.id) === index,
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
