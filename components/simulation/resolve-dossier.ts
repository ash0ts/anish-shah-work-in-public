import { simulationManifest } from "@/lib/server/simulation/policy";
import type { AnishContentBundle, PublicImpactMetric } from "@/types/content";
import type {
  SimulationDossier,
} from "./types";

function isPublicMetric(
  metric: AnishContentBundle["metrics"][number],
): metric is PublicImpactMetric {
  return (
    metric.publicationState === "public" &&
    "displayValue" in metric &&
    metric.displaySurfaces.includes("sources")
  );
}

export function resolveSimulationDossier(
  bundle: AnishContentBundle,
  publicationSource: SimulationDossier["publicationSource"],
): SimulationDossier {
  const workGroupById = new Map(
    bundle.workGroups
      .filter((group) => group.publicationState === "public")
      .map((group) => [group.id, group]),
  );
  const publicEvidenceIds = new Set(
    bundle.evidence
      .filter((evidence) => evidence.access === "public_web")
      .map((evidence) => evidence.id),
  );

  const facts = simulationManifest.facts.flatMap((fact) => {
    const group = fact.subjectIds
      .map((id) => workGroupById.get(id))
      .find(Boolean);
    if (!group || !simulationManifest.workFactIds.includes(fact.id)) return [];

    const evidence = fact.publicEvidenceIds.filter((id) =>
      publicEvidenceIds.has(id),
    );
    if (evidence.length === 0) return [];

    return [
      {
        id: fact.id,
        subjectIds: fact.subjectIds.filter((id) => workGroupById.has(id)),
        title: group.shortTitle || group.title,
        allowedStatement: fact.allowedStatement,
        qualifier: fact.qualifier ?? null,
        publicEvidenceIds: evidence,
        href: fact.href ?? `/work/${group.slug}`,
        bucket: group.bucket,
        roleSummary: group.roleSummary,
      },
    ];
  });

  const factIds = new Set(facts.map((fact) => fact.id));
  const scenes = simulationManifest.scenes.flatMap((scene) => {
    const candidateFactIds = scene.candidateFactIds.filter((id) =>
      factIds.has(id),
    );
    return candidateFactIds.length
      ? [{ ...scene, candidateFactIds }]
      : [];
  });

  const metrics = bundle.metrics
    .filter(isPublicMetric)
    .filter((metric) => simulationManifest.metricIds.includes(metric.id))
    .map((metric) => ({
      id: metric.id,
      displayValue: metric.displayValue,
      label: metric.label,
      qualifier: metric.qualifier,
      periodLabel: metric.period.label,
      sourceLabel: metric.sourceLabel,
    }));

  const providerDoorways = Object.entries(
    simulationManifest.providerGrounding,
  ).map(([provider, definition]) => ({
    provider: provider as SimulationDossier["providerDoorways"][number]["provider"],
    label: definition.label,
    route: definition.route,
  }));

  return {
    schemaVersion: "1.0",
    campaignVersion: simulationManifest.campaignVersion,
    contentVersion: bundle.contentVersion,
    generatedAt: bundle.generatedAt,
    publicationSource,
    persona: simulationManifest.persona,
    facts,
    metrics,
    scenes,
    providerDoorways,
    fallbackDialogue: simulationManifest.fallbackDialogue,
  };
}
