import type { AnishContentBundle, PublicImpactMetric } from "@/types/content";
import type {
  SimulationSceneId,
  TrustedFactCard,
} from "./contracts";
import { simulationManifest, simulationScene } from "./policy";

export type ResolvedSimulationGrounding = {
  factCards: TrustedFactCard[];
  allowedEntityIds: Set<string>;
  visibleEntityIds: Set<string>;
};

function isPublicMetric(
  metric: AnishContentBundle["metrics"][number],
): metric is PublicImpactMetric {
  return metric.publicationState === "public" && "displayValue" in metric;
}

function publicSubjectEvidence(
  bundle: AnishContentBundle,
): Map<string, Set<string>> {
  const publicEvidenceIds = new Set(
    bundle.evidence
      .filter((evidence) => evidence.access === "public_web")
      .map((evidence) => evidence.id),
  );
  const publicItems = bundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const itemById = new Map(publicItems.map((item) => [item.id, item]));
  const evidenceForItems = (itemIds: readonly string[]) =>
    new Set(
      itemIds.flatMap((itemId) =>
        (itemById.get(itemId)?.evidenceIds ?? []).filter((evidenceId) =>
          publicEvidenceIds.has(evidenceId),
        ),
      ),
    );

  const bySubject = new Map<string, Set<string>>();
  for (const item of publicItems) {
    bySubject.set(item.id, evidenceForItems([item.id]));
  }
  for (const entity of bundle.entities) {
    if (entity.publicationState !== "public") continue;
    const visibleItemIds = entity.itemIds.filter((itemId) => itemById.has(itemId));
    if (!visibleItemIds.length) continue;
    bySubject.set(entity.id, evidenceForItems(visibleItemIds));
  }
  for (const group of bundle.workGroups) {
    if (group.publicationState !== "public") continue;
    const visibleItemIds = group.itemIds.filter((itemId) => itemById.has(itemId));
    if (!visibleItemIds.length) continue;
    bySubject.set(group.id, evidenceForItems(visibleItemIds));
  }
  for (const metric of bundle.metrics.filter(isPublicMetric)) {
    bySubject.set(
      metric.id,
      new Set(
        metric.publicEvidenceIds.filter((evidenceId) =>
          publicEvidenceIds.has(evidenceId),
        ),
      ),
    );
  }

  return bySubject;
}

function activeFactCards(
  bundle: AnishContentBundle,
  sceneId: SimulationSceneId,
): Array<TrustedFactCard & { subjectIds: string[] }> {
  const scene = simulationScene(sceneId);
  if (!scene) return [];
  const evidenceBySubject = publicSubjectEvidence(bundle);
  const factsById = new Map(
    simulationManifest.facts.map((fact) => [fact.id, fact]),
  );

  return scene.candidateFactIds.flatMap((factId) => {
    const fact = factsById.get(factId);
    if (!fact) return [];
    const subjectIds = fact.subjectIds.filter((subjectId) =>
      evidenceBySubject.has(subjectId),
    );
    if (!subjectIds.length) return [];

    const associatedEvidenceIds = new Set(
      subjectIds.flatMap((subjectId) => [
        ...(evidenceBySubject.get(subjectId) ?? []),
      ]),
    );
    const evidenceIds = fact.publicEvidenceIds.filter((evidenceId) =>
      associatedEvidenceIds.has(evidenceId),
    );
    if (!evidenceIds.length) return [];

    return [
      {
        id: fact.id,
        statement: fact.allowedStatement,
        qualifier: fact.qualifier ?? null,
        href: fact.href ?? null,
        evidenceIds,
        subjectIds,
      },
    ];
  });
}

export function resolveSimulationGrounding(
  bundle: AnishContentBundle,
  sceneId: SimulationSceneId,
): ResolvedSimulationGrounding {
  const active = activeFactCards(bundle, sceneId);
  const visibleEntityIds = new Set(
    simulationManifest.scenes.flatMap((scene) =>
      activeFactCards(bundle, scene.id).flatMap((fact) => fact.subjectIds),
    ),
  );
  return {
    factCards: active.map((fact) => ({
      id: fact.id,
      statement: fact.statement,
      qualifier: fact.qualifier,
      href: fact.href,
      evidenceIds: [...fact.evidenceIds],
    })),
    allowedEntityIds: new Set(active.flatMap((fact) => fact.subjectIds)),
    visibleEntityIds,
  };
}

export function factCardsForGroundedEntities(
  bundle: AnishContentBundle,
  sceneId: SimulationSceneId,
  entityIds: readonly string[],
): TrustedFactCard[] {
  const selected = new Set(entityIds);
  return activeFactCards(bundle, sceneId).flatMap(
    ({ subjectIds, ...fact }) =>
      subjectIds.some((subjectId) => selected.has(subjectId)) ? [fact] : [],
  );
}
