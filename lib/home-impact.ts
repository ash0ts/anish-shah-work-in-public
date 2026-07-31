import type {
  AnishContentBundle,
  MetricTheme,
  PublicImpactMetric,
} from "@/types/content";

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

type TrackSpec = Omit<HomepageImpactTrack, "metrics"> & {
  metricKeys: Array<{
    key: string;
    shortLabel: string;
  }>;
};

const trackSpecs: TrackSpec[] = [
  {
    id: "deployed",
    theme: "product",
    label: "Use → return",
    statement: "Beyond first-run curiosity.",
    periodLabel: "Mar—Jul 2026",
    qualifier: "Internal analytics; measures are independent.",
    metricKeys: [
      {
        key: "mcp_users_and_organizations",
        shortLabel: "users · 1K+ organizations",
      },
      {
        key: "mcp_tool_calls",
        shortLabel: "MCP tool calls",
      },
      {
        key: "returning_user_share",
        shortLabel: "weekly active users returned",
      },
    ],
  },
  {
    id: "taught",
    theme: "learning",
    label: "Learning + action",
    statement: "Learning coincided with action.",
    periodLabel: "2024—26",
    qualifier:
      "Internal analytics; enrollments/signups are not unique learners; association is not conversion.",
    metricKeys: [
      {
        key: "course_enrollments",
        shortLabel: "enrollments · 3 courses",
      },
      {
        key: "same_day_account_creation_share",
        shortLabel: "same-day account association",
      },
      {
        key: "launch_signups",
        shortLabel: "Evals signups · ~36 hours",
      },
    ],
  },
  {
    id: "programs",
    theme: "programs",
    label: "Programs + pipeline",
    statement: "Downstream, not just attendance.",
    periodLabel: "2024—25",
    qualifier:
      "Internal analytics; supported pipeline is not revenue, ARR, or personal causality.",
    metricKeys: [
      {
        key: "pipeline_supported_2024_2025",
        shortLabel: "supported event pipeline",
      },
    ],
  },
];

export function homepageImpactTracksFrom(
  bundle: AnishContentBundle,
): HomepageImpactTrack[] {
  const publicMetrics = bundle.metrics.filter(
    (metric): metric is PublicImpactMetric =>
      "displayValue" in metric && metric.publicationState === "public",
  );
  const metricByKey = new Map(
    publicMetrics.map((metric) => [metric.key, metric]),
  );
  const allowedMetricIdsByTheme = new Map(
    bundle.metricGroups.map((group) => [
      group.theme,
      new Set(group.metricIds),
    ]),
  );

  return trackSpecs.flatMap((spec) => {
    const allowedIds = allowedMetricIdsByTheme.get(spec.theme);
    const metrics = spec.metricKeys.flatMap(({ key, shortLabel }) => {
      const metric = metricByKey.get(key);
      return metric && allowedIds?.has(metric.id)
        ? [{ metric, shortLabel }]
        : [];
    });
    if (!metrics.length) return [];

    return [
      {
        id: spec.id,
        theme: spec.theme,
        label: spec.label,
        statement: spec.statement,
        periodLabel: spec.periodLabel,
        qualifier: spec.qualifier,
        metrics,
      },
    ];
  });
}
