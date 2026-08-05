import manifestJson from "../../../content/presentation/simulation.v1.json" with {
  type: "json",
};
export {
  simulationExperienceEnabled,
  simulationExperienceMode,
  simulationExperienceVisible,
  type SimulationExperienceMode,
} from "./mode";
import {
  SIMULATION_RESPONSE_MODES,
  SIMULATION_VISITOR_SIGNALS,
  type ModelTurnOutput,
  type PlayProvider,
  type SimulationSceneId,
  type TrustedAction,
  type TrustedFactCard,
} from "./contracts";

type ManifestFact = {
  id: string;
  subjectIds: string[];
  allowedStatement: string;
  qualifier?: string;
  publicEvidenceIds: string[];
  href?: string;
};

type ManifestScene = {
  id: Exclude<SimulationSceneId, "complete">;
  title: string;
  encounter: string;
  candidateFactIds: string[];
  allowedActionIds: string[];
  fallbackDialogueIds: string[];
  allowsFreeText: boolean;
};

type ManifestFallback = ModelTurnOutput & { id: string };

type SimulationManifest = {
  schemaVersion: "1.0";
  campaignVersion: string;
  persona: {
    displayName: "4N1SH";
    accessibleName: "Anish simulation";
    disclosure: string;
  };
  workFactIds: string[];
  metricIds: string[];
  providerGrounding: Record<PlayProvider, { route: string; label: string }>;
  facts: ManifestFact[];
  scenes: ManifestScene[];
  fallbackDialogue: ManifestFallback[];
};

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const IDENTIFIER = /^[a-z0-9][a-z0-9:._-]{0,127}$/;
const INTERNAL_ROUTE = /^\/(?:work|play)\/[a-z0-9][a-z0-9/_-]{0,255}$/;

function validText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !CONTROL_CHARACTER.test(value)
  );
}

function uniqueStrings(
  value: unknown,
  maximumEntries: number,
  pattern = IDENTIFIER,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumEntries &&
    value.every(
      (entry) => typeof entry === "string" && pattern.test(entry),
    ) &&
    new Set(value).size === value.length
  );
}

function parseManifest(value: unknown): SimulationManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("simulation_manifest_invalid");
  }
  const record = value as Record<string, unknown>;
  const exactRootKeys = new Set([
    "schemaVersion",
    "campaignVersion",
    "persona",
    "workFactIds",
    "metricIds",
    "providerGrounding",
    "facts",
    "scenes",
    "fallbackDialogue",
  ]);
  if (
    record.schemaVersion !== "1.0" ||
    !validText(record.campaignVersion, 64) ||
    Object.keys(record).some((key) => !exactRootKeys.has(key)) ||
    Object.keys(record).length !== exactRootKeys.size ||
    !record.persona ||
    typeof record.persona !== "object" ||
    Array.isArray(record.persona) ||
    !uniqueStrings(record.workFactIds, 32) ||
    !uniqueStrings(record.metricIds, 32) ||
    !Array.isArray(record.facts) ||
    !Array.isArray(record.scenes) ||
    !Array.isArray(record.fallbackDialogue)
  ) {
    throw new Error("simulation_manifest_invalid");
  }

  const persona = record.persona as Record<string, unknown>;
  if (
    Object.keys(persona).length !== 3 ||
    persona.displayName !== "4N1SH" ||
    persona.accessibleName !== "Anish simulation" ||
    !validText(persona.disclosure, 320)
  ) {
    throw new Error("simulation_persona_invalid");
  }

  const facts = record.facts as unknown[];
  const parsedFacts: ManifestFact[] = facts.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("simulation_fact_invalid");
    }
    const fact = value as Record<string, unknown>;
    const allowedKeys = new Set([
      "id",
      "subjectIds",
      "allowedStatement",
      "qualifier",
      "publicEvidenceIds",
      "href",
    ]);
    if (
      typeof fact.id !== "string" ||
      !IDENTIFIER.test(fact.id) ||
      !uniqueStrings(fact.subjectIds, 16) ||
      !validText(fact.allowedStatement, 640) ||
      (fact.qualifier !== undefined && !validText(fact.qualifier, 320)) ||
      !uniqueStrings(fact.publicEvidenceIds, 32) ||
      (fact.href !== undefined &&
        (typeof fact.href !== "string" || !INTERNAL_ROUTE.test(fact.href))) ||
      Object.keys(fact).some((key) => !allowedKeys.has(key))
    ) {
      throw new Error("simulation_fact_invalid");
    }
    return fact as unknown as ManifestFact;
  });
  const factIds = new Set(parsedFacts.map((fact) => fact.id));
  if (factIds.size !== parsedFacts.length) {
    throw new Error("simulation_fact_duplicate");
  }
  if (!(record.workFactIds as string[]).every((id) => factIds.has(id))) {
    throw new Error("simulation_work_fact_invalid");
  }

  const parsedFallbacks: ManifestFallback[] = record.fallbackDialogue.map(
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("simulation_fallback_invalid");
      }
      const fallback = value as Record<string, unknown>;
      const allowedKeys = new Set([
        "id",
        "opponentLine",
        "responseMode",
        "revealEntityIds",
        "visitorSignals",
      ]);
      if (
        typeof fallback.id !== "string" ||
        !IDENTIFIER.test(fallback.id) ||
        !validText(fallback.opponentLine, 320) ||
        !SIMULATION_RESPONSE_MODES.includes(
          fallback.responseMode as (typeof SIMULATION_RESPONSE_MODES)[number],
        ) ||
        !uniqueStrings(fallback.revealEntityIds, 2) ||
        !uniqueStrings(
          fallback.visitorSignals,
          3,
          /^[a-z][a-z-]{0,63}$/,
        ) ||
        !(fallback.visitorSignals as string[]).every((signal) =>
          SIMULATION_VISITOR_SIGNALS.includes(
            signal as (typeof SIMULATION_VISITOR_SIGNALS)[number],
          ),
        ) ||
        Object.keys(fallback).some((key) => !allowedKeys.has(key))
      ) {
        throw new Error("simulation_fallback_invalid");
      }
      return fallback as unknown as ManifestFallback;
    },
  );
  const fallbackIds = new Set(parsedFallbacks.map((entry) => entry.id));
  if (fallbackIds.size !== parsedFallbacks.length) {
    throw new Error("simulation_fallback_duplicate");
  }

  const expectedScenes = ["act-1", "act-2", "act-3", "boss"];
  const parsedScenes: ManifestScene[] = record.scenes.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("simulation_scene_invalid");
    }
    const scene = value as Record<string, unknown>;
    const allowedKeys = new Set([
      "id",
      "title",
      "encounter",
      "candidateFactIds",
      "allowedActionIds",
      "fallbackDialogueIds",
      "allowsFreeText",
    ]);
    if (
      typeof scene.id !== "string" ||
      !expectedScenes.includes(scene.id) ||
      !validText(scene.title, 128) ||
      !validText(scene.encounter, 512) ||
      !uniqueStrings(scene.candidateFactIds, 32) ||
      !(scene.candidateFactIds as string[]).every((id) => factIds.has(id)) ||
      !uniqueStrings(scene.allowedActionIds, 16, /^[a-z][a-z0-9-]{0,63}$/) ||
      !uniqueStrings(scene.fallbackDialogueIds, 16) ||
      !(scene.fallbackDialogueIds as string[]).every((id) =>
        fallbackIds.has(id),
      ) ||
      (scene.allowedActionIds as string[]).length !==
        (scene.fallbackDialogueIds as string[]).length ||
      typeof scene.allowsFreeText !== "boolean" ||
      Object.keys(scene).some((key) => !allowedKeys.has(key))
    ) {
      throw new Error("simulation_scene_invalid");
    }
    return scene as unknown as ManifestScene;
  });
  if (
    parsedScenes.length !== expectedScenes.length ||
    parsedScenes.some((scene, index) => scene.id !== expectedScenes[index])
  ) {
    throw new Error("simulation_scene_sequence_invalid");
  }

  const providers = [
    "myanimelist",
    "hardcover",
    "spotify",
    "discogs",
    "steam",
    "strava",
  ] as const;
  if (
    !record.providerGrounding ||
    typeof record.providerGrounding !== "object" ||
    Array.isArray(record.providerGrounding)
  ) {
    throw new Error("simulation_provider_grounding_invalid");
  }
  const grounding = record.providerGrounding as Record<string, unknown>;
  if (
    Object.keys(grounding).length !== providers.length ||
    providers.some((provider) => {
      const entry = grounding[provider];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return true;
      }
      const candidate = entry as Record<string, unknown>;
      return !(
        Object.keys(candidate).length === 2 &&
        validText(candidate.label, 32) &&
        typeof candidate.route === "string" &&
        INTERNAL_ROUTE.test(candidate.route)
      );
    })
  ) {
    throw new Error("simulation_provider_grounding_invalid");
  }

  return {
    schemaVersion: "1.0",
    campaignVersion: record.campaignVersion,
    persona: persona as SimulationManifest["persona"],
    workFactIds: [...(record.workFactIds as string[])],
    metricIds: [...(record.metricIds as string[])],
    providerGrounding: grounding as SimulationManifest["providerGrounding"],
    facts: parsedFacts,
    scenes: parsedScenes,
    fallbackDialogue: parsedFallbacks,
  };
}

export const simulationManifest = parseManifest(manifestJson);

const factsById = new Map(
  simulationManifest.facts.map((fact) => [fact.id, fact]),
);
const scenesById = new Map(
  simulationManifest.scenes.map((scene) => [scene.id, scene]),
);
const fallbackById = new Map(
  simulationManifest.fallbackDialogue.map((entry) => [entry.id, entry]),
);

export function simulationScene(
  id: SimulationSceneId,
): ManifestScene | null {
  return id === "complete" ? null : (scenesById.get(id) ?? null);
}

export function nextSimulationScene(
  id: Exclude<SimulationSceneId, "complete">,
): SimulationSceneId {
  const index = simulationManifest.scenes.findIndex((scene) => scene.id === id);
  return simulationManifest.scenes[index + 1]?.id ?? "complete";
}

export function trustedActions(sceneId: SimulationSceneId): TrustedAction[] {
  const scene = simulationScene(sceneId);
  return scene
    ? scene.allowedActionIds.map((id) => ({ id, sceneId: scene.id }))
    : [];
}

export function isAllowedSimulationAction(
  sceneId: SimulationSceneId,
  actionId: string,
): boolean {
  return simulationScene(sceneId)?.allowedActionIds.includes(actionId) ?? false;
}

export function sceneAllowsFreeText(sceneId: SimulationSceneId): boolean {
  return simulationScene(sceneId)?.allowsFreeText ?? false;
}

export function candidateFactCards(sceneId: SimulationSceneId): TrustedFactCard[] {
  const scene = simulationScene(sceneId);
  if (!scene) return [];
  return scene.candidateFactIds.flatMap((id) => {
    const fact = factsById.get(id);
    return fact
      ? [
          {
            id: fact.id,
            statement: fact.allowedStatement,
            qualifier: fact.qualifier ?? null,
            href: fact.href ?? null,
            evidenceIds: [...fact.publicEvidenceIds],
          },
        ]
      : [];
  });
}

export function allowedEntityIds(sceneId: SimulationSceneId): Set<string> {
  const scene = simulationScene(sceneId);
  if (!scene) return new Set();
  return new Set(
    scene.candidateFactIds.flatMap((id) => factsById.get(id)?.subjectIds ?? []),
  );
}

export function factCardsForEntities(
  sceneId: SimulationSceneId,
  entityIds: readonly string[],
): TrustedFactCard[] {
  const selected = new Set(entityIds);
  const scene = simulationScene(sceneId);
  if (!scene) return [];
  return scene.candidateFactIds.flatMap((id) => {
    const fact = factsById.get(id);
    if (!fact || !fact.subjectIds.some((subjectId) => selected.has(subjectId))) {
      return [];
    }
    return [
      {
        id: fact.id,
        statement: fact.allowedStatement,
        qualifier: fact.qualifier ?? null,
        href: fact.href ?? null,
        evidenceIds: [...fact.publicEvidenceIds],
      },
    ];
  });
}

export function authoredFallback(
  sceneId: Exclude<SimulationSceneId, "complete">,
  actionId: string,
): ModelTurnOutput {
  const scene = simulationScene(sceneId);
  const actionIndex = scene?.allowedActionIds.indexOf(actionId) ?? -1;
  const fallbackId =
    actionIndex >= 0 ? scene?.fallbackDialogueIds[actionIndex] : undefined;
  const fallback = fallbackId ? fallbackById.get(fallbackId) : undefined;
  if (!fallback) {
    return {
      opponentLine:
        "The public model lost the thread. Keep the evidence and continue.",
      responseMode: "redirect",
      revealEntityIds: [],
      visitorSignals: [],
    };
  }
  return {
    opponentLine: fallback.opponentLine,
    responseMode: fallback.responseMode,
    revealEntityIds: [...fallback.revealEntityIds],
    visitorSignals: [...fallback.visitorSignals],
  };
}

export function providerGroundingForAction(actionId: string): {
  provider: PlayProvider;
  label: string;
  route: string;
} | null {
  const providerByAction: Record<string, PlayProvider> = {
    watch: "myanimelist",
    read: "hardcover",
    listen: "spotify",
    collect: "discogs",
    play: "steam",
    move: "strava",
  };
  const provider = providerByAction[actionId];
  const entry = provider ? simulationManifest.providerGrounding[provider] : null;
  return provider && entry
    ? { provider, label: entry.label, route: entry.route }
    : null;
}
