import type {
  AnishContentBundle,
  CanonicalEntity,
  CanonicalEntityKind,
  PortfolioItem,
  PublicImpactMetric,
} from "@/types/content";

function publicMetrics(bundle: AnishContentBundle): PublicImpactMetric[] {
  return bundle.metrics.filter(
    (metric): metric is PublicImpactMetric =>
      "displayValue" in metric && metric.publicationState === "public",
  );
}

export function findItemBySlugFrom(
  bundle: AnishContentBundle,
  slug: string,
): PortfolioItem | undefined {
  return bundle.items.find(
    (item) =>
      (item.slug === slug || item.slugAliases.includes(slug)) &&
      item.publicationState === "public",
  );
}

export function metricsForItemFrom(
  bundle: AnishContentBundle,
  item: PortfolioItem,
): PublicImpactMetric[] {
  return publicMetrics(bundle).filter(
    (metric) =>
      metric.displaySurfaces.includes("item_detail") &&
      (metric.subjectId === item.id ||
        metric.subjectId === item.canonicalEntityId),
  );
}

export function collectionMetricsFrom(
  bundle: AnishContentBundle,
  collectionId: string,
): PublicImpactMetric[] {
  const collection = bundle.collections.find(
    (candidate) => candidate.id === collectionId,
  );
  if (!collection) return [];
  const ids = new Set(collection.metricIds);
  return publicMetrics(bundle).filter(
    (metric) =>
      ids.has(metric.id) && metric.displaySurfaces.includes("collection"),
  );
}

export function entityForItemFrom(
  bundle: AnishContentBundle,
  item: PortfolioItem,
): CanonicalEntity | undefined {
  return bundle.entities.find((entity) => entity.id === item.canonicalEntityId);
}

export function itemsForEntityFrom(
  bundle: AnishContentBundle,
  entity: CanonicalEntity,
): PortfolioItem[] {
  const ids = new Set(entity.itemIds);
  return bundle.items.filter(
    (item) => ids.has(item.id) && item.publicationState === "public",
  );
}

export function entitiesOfKindFrom(
  bundle: AnishContentBundle,
  kind: CanonicalEntityKind,
): CanonicalEntity[] {
  return bundle.entities.filter(
    (entity) => entity.kind === kind && entity.publicationState === "public",
  );
}

export function findEntityBySlugFrom(
  bundle: AnishContentBundle,
  slug: string,
): CanonicalEntity | undefined {
  return bundle.entities.find(
    (entity) =>
      (entity.slug === slug || entity.slugAliases.includes(slug)) &&
      entity.publicationState === "public",
  );
}

export function workIndexEntriesFrom(
  bundle: AnishContentBundle,
  { includeSupplemental = false }: { includeSupplemental?: boolean } = {},
): CanonicalEntity[] {
  return bundle.entities
    .filter(
      (entity) =>
        entity.publicationState === "public" &&
        entity.countability === "unique_work" &&
        (includeSupplemental || entity.sourceBasis !== "supplemental"),
    )
    .sort(
      (left, right) =>
        (right.representativeDate.start || "").localeCompare(
          left.representativeDate.start || "",
        ) || left.displayTitle.localeCompare(right.displayTitle),
    );
}

export function supplementalWorkEntriesFrom(
  bundle: AnishContentBundle,
): CanonicalEntity[] {
  return bundle.entities
    .filter(
      (entity) =>
        entity.publicationState === "public" &&
        entity.countability === "unique_work" &&
        entity.sourceBasis === "supplemental",
    )
    .sort(
      (left, right) =>
        (right.representativeDate.start || "").localeCompare(
          left.representativeDate.start || "",
        ) || left.displayTitle.localeCompare(right.displayTitle),
    );
}
