import manifest from "@/content/presentation/metric-history.v1.json" with { type: "json" };

// Presentation only: historical observations keep their original units,
// qualifiers, source IDs and deep links in the canonical publication.
if (manifest.schemaVersion !== "1.0" ||
    Object.keys(manifest).sort().join(",") !== "metricIds,schemaVersion" ||
    !Array.isArray(manifest.metricIds) ||
    new Set(manifest.metricIds).size !== manifest.metricIds.length ||
    manifest.metricIds.some((id) => !/^metric:[a-z0-9:-]+$/u.test(id))) {
  throw new Error("metric_history_manifest_invalid");
}

export const historicalMetricIds: ReadonlySet<string> = new Set(manifest.metricIds);

export function splitMetricHistory<T extends { id: string }>(metrics: readonly T[]) {
  return {
    current: metrics.filter(({ id }) => !historicalMetricIds.has(id)),
    historical: metrics.filter(({ id }) => historicalMetricIds.has(id)),
  };
}
