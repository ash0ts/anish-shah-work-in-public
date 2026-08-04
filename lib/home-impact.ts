import type {
  AnishContentBundle,
  MetricTheme,
  PublicImpactMetric,
} from "@/types/content";
import { SITE_COPY } from "@/lib/copy";

export type HomepageImpactDatum = {
  metric: PublicImpactMetric;
  shortLabel: string;
};

export type HomepageImpactTrack = {
  id: "deployed" | "taught" | "programs";
  theme: Extract<MetricTheme, "product" | "learning" | "programs">;
  label: string;
  statement: string;
  periodLabel: string;
  qualifier: string;
  metrics: HomepageImpactDatum[];
};

const trackSpecs = [
  {
    id: "deployed",
    theme: "product",
    metricId: "metric:project:wandb-mcp-server:tool-calls:2026-07-29",
    label: SITE_COPY.home["proof-1-label"],
    statement: SITE_COPY.home["proof-1-statement"],
    shortLabel: "MCP tool calls",
  },
  {
    id: "taught",
    theme: "learning",
    metricId: "metric:courses:enrollments:2026-07-30",
    label: SITE_COPY.home["proof-2-label"],
    statement: SITE_COPY.home["proof-2-statement"],
    shortLabel: "course enrollments",
  },
  {
    id: "programs",
    theme: "programs",
    metricId: "metric:events:pipeline-supported:2024-2025",
    label: SITE_COPY.home["proof-3-label"],
    statement: SITE_COPY.home["proof-3-statement"],
    shortLabel: "supported event pipeline",
  },
] as const;

export const homepageImpactMetricIds = trackSpecs.map((spec) => spec.metricId);

export function homepageImpactTracksFrom(
  bundle: AnishContentBundle,
): HomepageImpactTrack[] {
  const publicMetrics = new Map(
    bundle.metrics
      .filter(
        (metric): metric is PublicImpactMetric =>
          "displayValue" in metric && metric.publicationState === "public",
      )
      .map((metric) => [metric.id, metric]),
  );
  const allowedMetricIdsByTheme = new Map(
    bundle.metricGroups.map((group) => [group.theme, new Set(group.metricIds)]),
  );

  return trackSpecs.map((spec) => {
    const metric = publicMetrics.get(spec.metricId);
    if (!metric || !allowedMetricIdsByTheme.get(spec.theme)?.has(metric.id)) {
      throw new Error(
        `Required homepage metric ${spec.metricId} is missing, unpublished, or assigned to the wrong theme.`,
      );
    }
    const qualifier = metric.qualifier?.trim();
    if (!qualifier) {
      throw new Error(
        `Homepage metric ${metric.id} must be public and include its limit.`,
      );
    }
    return {
      id: spec.id,
      theme: spec.theme,
      label: spec.label,
      statement: spec.statement,
      periodLabel: metric.period.label,
      qualifier,
      metrics: [{ metric, shortLabel: spec.shortLabel }],
    };
  });
}
