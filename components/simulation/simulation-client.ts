import type {
  CuriosityVector,
  ModelTurnOutput,
  SimulationDifficulty,
  SimulationDossier,
  SimulationMode,
  SimulationSceneId,
  SimulationTurnRequest,
  SimulationTurnResponse,
} from "./types";

type SessionEnvelope = {
  status?: string;
  session?: {
    revision?: number;
  };
};

const responseModes = new Set([
  "counter",
  "probe",
  "acknowledge",
  "redirect",
]);

const visitorSignals = new Set([
  "evaluation-rigor",
  "systems-thinking",
  "teaching",
  "open-source",
  "community",
  "playful-curiosity",
]);

function validOpponent(value: unknown): value is ModelTurnOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const opponent = value as Record<string, unknown>;
  return (
    typeof opponent.opponentLine === "string" &&
    opponent.opponentLine.length > 0 &&
    opponent.opponentLine.length <= 600 &&
    typeof opponent.responseMode === "string" &&
    responseModes.has(opponent.responseMode) &&
    Array.isArray(opponent.revealEntityIds) &&
    opponent.revealEntityIds.every((id) => typeof id === "string") &&
    Array.isArray(opponent.visitorSignals) &&
    opponent.visitorSignals.every(
      (signal) => typeof signal === "string" && visitorSignals.has(signal),
    )
  );
}

function validTurnResponse(value: unknown): value is SimulationTurnResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return (
    Number.isInteger(response.revision) &&
    (response.source === "generated" ||
      response.source === "fixture" ||
      response.source === "authored_fallback") &&
    validOpponent(response.opponent) &&
    Array.isArray(response.factCards) &&
    Array.isArray(response.nextActions)
  );
}

export async function startSimulationSession(
  mode: SimulationMode,
  difficulty: SimulationDifficulty,
  curiosity: CuriosityVector,
  signal?: AbortSignal,
): Promise<number> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch("/api/simulation/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, difficulty, curiosity }),
      signal: controller.signal,
    });
    if (!response.ok) return 0;
    const body = (await response.json()) as SessionEnvelope;
    return body.status === "ready" && Number.isInteger(body.session?.revision)
      ? Number(body.session?.revision)
      : 0;
  } catch {
    return 0;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

export function authoredSimulationFallback(
  dossier: SimulationDossier,
  sceneId: SimulationSceneId,
  actionId: string,
  revision: number,
): SimulationTurnResponse {
  const scene = dossier.scenes.find((candidate) => candidate.id === sceneId);
  const actionIndex = Math.max(
    0,
    scene?.allowedActionIds.indexOf(actionId) ?? 0,
  );
  const fallbackId = scene?.fallbackDialogueIds[actionIndex];
  const fallback =
    dossier.fallbackDialogue.find((entry) => entry.id === fallbackId) ??
    dossier.fallbackDialogue.find((entry) =>
      scene?.fallbackDialogueIds.includes(entry.id),
    ) ?? {
      id: "fallback:generic",
      opponentLine:
        "The live model is unavailable. The public record is still here, so the simulation can continue.",
      responseMode: "redirect" as const,
      revealEntityIds: [],
      visitorSignals: [],
    };
  const revealSet = new Set(fallback.revealEntityIds);

  return {
    revision: revision + 1,
    source: "authored_fallback",
    opponent: {
      opponentLine: fallback.opponentLine,
      responseMode: fallback.responseMode,
      revealEntityIds: fallback.revealEntityIds,
      visitorSignals: fallback.visitorSignals,
    },
    factCards: dossier.facts
      .filter((fact) => fact.subjectIds.some((id) => revealSet.has(id)))
      .map((fact) => ({
        id: fact.id,
        statement: fact.allowedStatement,
        qualifier: fact.qualifier,
        href: fact.href,
        evidenceIds: fact.publicEvidenceIds,
      })),
    nextActions: (scene?.allowedActionIds ?? []).map((id) => ({
      id,
      sceneId,
    })),
  };
}

export async function requestSimulationTurn(
  dossier: SimulationDossier,
  request: SimulationTurnRequest,
  signal?: AbortSignal,
): Promise<SimulationTurnResponse> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch("/api/simulation/turn", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-request-id": request.requestId,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      return authoredSimulationFallback(
        dossier,
        request.sceneId,
        request.actionId,
        request.revision,
      );
    }
    const body: unknown = await response.json();
    return validTurnResponse(body)
      ? body
      : authoredSimulationFallback(
          dossier,
          request.sceneId,
          request.actionId,
          request.revision,
        );
  } catch {
    return authoredSimulationFallback(
      dossier,
      request.sceneId,
      request.actionId,
      request.revision,
    );
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

export async function endSimulationSession(): Promise<void> {
  try {
    await fetch("/api/simulation/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    // Session expiry is a server-side safety net. Exit remains available offline.
  }
}
