import type {
  AnishContentBundle,
  MetricTheme,
  PublicImpactMetric,
} from "@/types/content";
import { SITE_COPY } from "@/lib/copy";
import {
  homePresentationManifest,
  type HomeSignalIconId,
} from "@/lib/home-presentation";

export type HomepageImpactDatum = {
  metric: PublicImpactMetric;
};

export type HomepageImpactTrack = {
  id: "deployed" | "taught" | "programs";
  theme: Extract<MetricTheme, "product" | "learning" | "programs">;
  label: string;
  iconId: HomeSignalIconId;
  explanation: string;
  periodLabel: string;
  periodAsOf: string | null;
  qualifier: string;
  metrics: HomepageImpactDatum[];
  supportingMetrics: PublicImpactMetric[];
};

const trackSpecs = homePresentationManifest.signals.map((signal) => ({
  ...signal,
  label: {
    deployed: SITE_COPY.home["proof-1-label"],
    taught: SITE_COPY.home["proof-2-label"],
    programs: SITE_COPY.home["proof-3-label"],
  }[signal.id],
}));

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
    const supportingMetrics = spec.id === "deployed"
      ? homePresentationManifest.supportingMetricIds.flatMap((id) => {
          const supporting = publicMetrics.get(id);
          return supporting?.displaySurfaces.includes("homepage") &&
            supporting.subjectId === metric.subjectId &&
            allowedMetricIdsByTheme.get(spec.theme)?.has(id)
            ? [supporting] : [];
        })
      : [];
    return {
      id: spec.id,
      theme: spec.theme,
      label: spec.label,
      iconId: spec.iconId,
      explanation: spec.explanation,
      periodLabel: metric.period.label,
      periodAsOf: metric.period.asOf ?? null,
      qualifier,
      metrics: [{ metric }],
      supportingMetrics,
    };
  });
}
