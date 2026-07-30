import publicBundleJson from "@/content/public/anish-content.public.v1.json";
import type {
  AnishContentBundle,
  EvidenceSource,
  Organization,
  PortfolioItem,
  PublicImpactMetric,
  Relation,
} from "@/types/content";

export const publicBundle = publicBundleJson as AnishContentBundle;

export const organizationsById = new Map(
  publicBundle.organizations.map((organization) => [organization.id, organization]),
);

export const evidenceById = new Map(
  publicBundle.evidence.map((evidence) => [evidence.id, evidence]),
);

export function organizationNames(item: PortfolioItem): string[] {
  return item.organizationIds
    .map((id) => organizationsById.get(id)?.name)
    .filter((name): name is string => Boolean(name));
}

export function evidenceForItem(item: PortfolioItem): EvidenceSource[] {
  return item.evidenceIds
    .map((id) => evidenceById.get(id))
    .filter(
      (evidence): evidence is EvidenceSource =>
        Boolean(evidence && evidence.access === "public_web"),
    );
}

export function publicMetrics(): PublicImpactMetric[] {
  return publicBundle.metrics.filter(
    (metric): metric is PublicImpactMetric =>
      "displayValue" in metric && metric.publicationState === "public",
  );
}

const preferredMetricKeys = [
  "course_enrollments",
  "mcp_tool_calls",
  "mcp_users",
  "event_pipeline_supported",
  "gtc_leads",
  "fully_connected_attendees",
  "public_event_references",
  "recording_hours",
];

export function strongestPublicMetrics(limit = 6): PublicImpactMetric[] {
  const metrics = publicMetrics();
  const ordered = preferredMetricKeys
    .map((key) => metrics.find((metric) => metric.key === key))
    .filter((metric): metric is PublicImpactMetric => Boolean(metric));
  const remainder = metrics.filter(
    (metric) => !ordered.some((candidate) => candidate.id === metric.id),
  );
  return [...ordered, ...remainder].slice(0, limit);
}

const homepageMetricIds = [
  "metric:courses:enrollments:2026-07-30",
  "metric:project:wandb-mcp-server:tool-calls:2026-06-11",
  "metric:events:pipeline-supported:2025",
];

export function homepageMetrics(): PublicImpactMetric[] {
  const metrics = publicMetrics();
  return homepageMetricIds
    .map((id) => metrics.find((metric) => metric.id === id))
    .filter((metric): metric is PublicImpactMetric => Boolean(metric));
}

export function featuredItems(limit = 6): PortfolioItem[] {
  const published = publicBundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const featured = published.filter((item) => item.featured);
  return (featured.length ? featured : published)
    .sort((a, b) => (b.date.start ?? "").localeCompare(a.date.start ?? ""))
    .slice(0, limit);
}

export function findItemBySlug(slug: string): PortfolioItem | undefined {
  return publicBundle.items.find(
    (item) => item.slug === slug && item.publicationState === "public",
  );
}

export function metricsForItem(item: PortfolioItem): PublicImpactMetric[] {
  const direct = publicMetrics().filter((metric) => metric.subjectId === item.id);
  const containingCollections = publicBundle.collections.filter((collection) =>
    collection.itemIds.includes(item.id),
  );
  const collectionMetricIds = new Set(
    containingCollections.flatMap((collection) => collection.metricIds),
  );
  return [
    ...direct,
    ...publicMetrics().filter((metric) => collectionMetricIds.has(metric.id)),
  ].filter(
    (metric, index, all) =>
      all.findIndex((candidate) => candidate.id === metric.id) === index,
  );
}

export function organizationById(id: string): Organization | undefined {
  return organizationsById.get(id);
}

export function formatItemType(type: PortfolioItem["type"]): string {
  return type.replaceAll("_", " ");
}

export function formatDate(item: PortfolioItem): string {
  if (!item.date.start) return item.year ? String(item.year) : "Date unlisted";
  if (item.date.precision === "year") return item.date.start.slice(0, 4);
  if (item.date.precision === "month") {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${item.date.start.slice(0, 7)}-01T00:00:00Z`));
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${item.date.start}T00:00:00Z`));
}

export function relatedItems(
  item: PortfolioItem,
): Array<{ item: PortfolioItem; relation: Relation; direction: "from" | "to" }> {
  return publicBundle.relations
    .filter((relation) => relation.fromId === item.id || relation.toId === item.id)
    .map((relation) => {
      const direction = relation.fromId === item.id ? "from" : "to";
      const relatedId =
        direction === "from" ? relation.toId : relation.fromId;
      return {
        item: publicBundle.items.find((candidate) => candidate.id === relatedId),
        relation,
        direction,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        item: PortfolioItem;
        relation: Relation;
        direction: "from" | "to";
      } => Boolean(entry.item && entry.item.publicationState === "public"),
    );
}
