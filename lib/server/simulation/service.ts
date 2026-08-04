import { runtimeDatabase, runtimeValue } from "../runtime-env";
import { getPublicContentView } from "../public-content";
import type { AnishContentBundle } from "@/types/content";
import { providerApprovedForSimulationModel } from "./approvals";
import {
  SIMULATION_CAMPAIGN_VERSION,
  type CreateSimulationSessionInput,
  type GroundedTurnInput,
  type ModelTurnOutput,
  type SimulationDialogueProvider,
  type SimulationSafeState,
  type SimulationSessionPublic,
  type SimulationTurnRequest,
  type SimulationTurnResponse,
} from "./contracts";
import {
  authoredFallback,
  nextSimulationScene,
  providerGroundingForAction,
  simulationExperienceEnabled,
  trustedActions,
} from "./policy";
import {
  factCardsForGroundedEntities,
  resolveSimulationGrounding,
} from "./grounding";
import { simulationDialogueProvider } from "./provider";
import { resolveSimulationPlayGrounding } from "./play-grounding";
import {
  claimSimulationDailyBudget,
  completeSimulationTurn,
  createSimulationSession,
  deleteSimulationSession,
  getSimulationSession,
  publicSimulationSession,
  recordSimulationFallback,
  recordSimulationGenerationSuccess,
  releaseSimulationTurn,
  reserveSimulationTurn,
  type StoredSimulationSession,
} from "./repository";
import {
  createSimulationSessionToken,
  hashSimulationSessionToken,
  simulationSessionTokenFromRequest,
  validSimulationSessionHmacKey,
} from "./session-crypto";
import {
  simulationAiMode,
  simulationDailyModelLimit,
} from "./runtime";
import { validateModelTurnOutput } from "./validation";

const MAX_TURNS = 12;
const MAX_FREE_TEXT_TURNS = 2;
const MAX_GENERATION_CALLS = 4;

export class SimulationServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SimulationServiceError";
    this.code = code;
    this.status = status;
  }
}

export async function resolveSimulationProviderTurn(input: {
  provider: SimulationDialogueProvider | null;
  groundedInput: GroundedTurnInput;
  sceneId: SimulationTurnRequest["sceneId"];
  eligibleEntities: ReadonlySet<string>;
  authored: ModelTurnOutput;
}): Promise<{
  source: SimulationTurnResponse["source"];
  opponent: ModelTurnOutput;
}> {
  if (!input.provider) {
    return { source: "authored_fallback", opponent: input.authored };
  }
  try {
    const candidate = await input.provider.generateTurn(input.groundedInput);
    const validated = validateModelTurnOutput(
      candidate,
      input.sceneId,
      input.eligibleEntities,
    );
    return validated
      ? { source: input.provider.source, opponent: validated }
      : { source: "authored_fallback", opponent: input.authored };
  } catch {
    return { source: "authored_fallback", opponent: input.authored };
  }
}

function dependencies(): { database: D1Database; hmacKey: string } {
  const database = runtimeDatabase();
  const hmacKey = runtimeValue("SIMULATION_SESSION_HMAC_KEY");
  if (!database || !validSimulationSessionHmacKey(hmacKey)) {
    throw new SimulationServiceError(
      "simulation_setup_required",
      "The simulation session service is not configured.",
      503,
    );
  }
  return { database, hmacKey: hmacKey as string };
}

export function simulationApiEnabled(): boolean {
  return (
    simulationExperienceEnabled() && runtimeValue("DEPLOYMENT_TIER") !== "preview"
  );
}

function assertApiAvailable(): void {
  if (!simulationApiEnabled()) {
    throw new SimulationServiceError(
      "simulation_not_found",
      "The simulation is not available.",
      404,
    );
  }
  if (simulationAiMode() === "invalid") {
    throw new SimulationServiceError(
      "simulation_mode_invalid",
      "The hosted simulation configuration is invalid.",
      503,
    );
  }
}

async function sessionHashFromRequest(
  request: Request,
  hmacKey: string,
): Promise<string | null> {
  const token = simulationSessionTokenFromRequest(request);
  return token ? hashSimulationSessionToken(token, hmacKey) : null;
}

export async function readSimulationSession(
  request: Request,
): Promise<SimulationSessionPublic | null> {
  assertApiAvailable();
  const { database, hmacKey } = dependencies();
  const hash = await sessionHashFromRequest(request, hmacKey);
  if (!hash) return null;
  const session = await getSimulationSession(database, hash);
  if (!session) return null;
  const { bundle } = await getPublicContentView();
  const visibleEntityIds = resolveSimulationGrounding(
    bundle,
    "act-1",
  ).visibleEntityIds;
  const projection = publicSimulationSession(session);
  return {
    ...projection,
    state: {
      ...projection.state,
      revealedEntityIds: projection.state.revealedEntityIds.filter((id) =>
        visibleEntityIds.has(id),
      ),
    },
  };
}

export async function startSimulationSession(
  request: Request,
  input: CreateSimulationSessionInput,
): Promise<{ token: string; session: SimulationSessionPublic }> {
  assertApiAvailable();
  const { database, hmacKey } = dependencies();
  const existingHash = await sessionHashFromRequest(request, hmacKey);
  if (existingHash) await deleteSimulationSession(database, existingHash);
  const token = createSimulationSessionToken();
  const sessionHash = await hashSimulationSessionToken(token, hmacKey);
  const session = await createSimulationSession(database, sessionHash, input);
  return { token, session: publicSimulationSession(session) };
}

export async function endSimulationSession(request: Request): Promise<void> {
  assertApiAvailable();
  const { database, hmacKey } = dependencies();
  const hash = await sessionHashFromRequest(request, hmacKey);
  if (hash) await deleteSimulationSession(database, hash);
}

function deterministicState(
  session: StoredSimulationSession,
  request: SimulationTurnRequest,
  opponent: ModelTurnOutput,
  visibleEntityIds: ReadonlySet<string>,
): SimulationSafeState {
  const visitorSignals = [...new Set([
    ...session.state.visitorSignals,
    ...opponent.visitorSignals,
  ])].slice(0, 6);
  const revealedEntityIds = [...new Set([
    ...session.state.revealedEntityIds.filter((id) => visibleEntityIds.has(id)),
    ...opponent.revealEntityIds,
  ])].slice(0, 16);
  const groundedActions = new Set([
    "trace",
    "qualify",
    "ground-the-claim",
    "keep-the-qualifier",
    "connect-the-facets",
  ]);
  const playGrounding = providerGroundingForAction(request.actionId);
  return {
    ...session.state,
    score: {
      signalFound: Math.min(12, session.state.score.signalFound + 1),
      claimsGrounded: Math.min(
        12,
        session.state.score.claimsGrounded +
          (groundedActions.has(request.actionId) ? 1 : 0),
      ),
      curiosityFollowed: Math.min(
        12,
        session.state.score.curiosityFollowed + (request.sceneId === "act-3" ? 1 : 0),
      ),
    },
    visitorSignals,
    revealedEntityIds,
    selectedPlayRoute:
      request.sceneId === "act-3" && playGrounding
        ? playGrounding.route
        : session.state.selectedPlayRoute,
  };
}

function projectedNextSession(
  current: StoredSimulationSession,
  nextSceneId: ReturnType<typeof nextSimulationScene>,
  nextState: SimulationSafeState,
  options: { usedFreeText: boolean; usedProvider: boolean },
): StoredSimulationSession {
  return {
    ...current,
    status: nextSceneId === "complete" ? "complete" : "active",
    revision: current.revision + 1,
    sceneId: nextSceneId,
    state: nextState,
    freeTextTurns: current.freeTextTurns + (options.usedFreeText ? 1 : 0),
    generationCalls:
      current.generationCalls + (options.usedProvider ? 1 : 0),
    turnCount: current.turnCount + 1,
    pendingRequestId: null,
    generationLeaseUntil: null,
    lastRequestId: null,
    lastResponse: null,
  };
}

function projectTurnResponseForPublication(
  response: SimulationTurnResponse,
  bundle: AnishContentBundle,
  sceneId: SimulationTurnRequest["sceneId"],
  allowedEntityIds: ReadonlySet<string>,
  visibleEntityIds: ReadonlySet<string>,
): SimulationTurnResponse {
  const revealEntityIds = response.opponent.revealEntityIds.filter((id) =>
    allowedEntityIds.has(id),
  );
  return {
    ...response,
    opponent: { ...response.opponent, revealEntityIds },
    factCards: factCardsForGroundedEntities(bundle, sceneId, revealEntityIds),
    session: {
      ...response.session,
      state: {
        ...response.session.state,
        revealedEntityIds: response.session.state.revealedEntityIds.filter(
          (id) => visibleEntityIds.has(id),
        ),
      },
    },
  };
}

export async function submitSimulationTurn(
  request: Request,
  turn: SimulationTurnRequest,
): Promise<SimulationTurnResponse> {
  assertApiAvailable();
  const { database, hmacKey } = dependencies();
  const sessionHash = await sessionHashFromRequest(request, hmacKey);
  if (!sessionHash) {
    throw new SimulationServiceError(
      "simulation_session_required",
      "Start a simulation session before submitting a turn.",
      401,
    );
  }
  const { bundle } = await getPublicContentView();
  const activeGrounding = resolveSimulationGrounding(bundle, turn.sceneId);
  const reserved = await reserveSimulationTurn(
    database,
    sessionHash,
    turn.revision,
    turn.requestId,
  );
  if (reserved.status === "idempotent") {
    return projectTurnResponseForPublication(
      reserved.response,
      bundle,
      turn.sceneId,
      activeGrounding.allowedEntityIds,
      activeGrounding.visibleEntityIds,
    );
  }
  if (reserved.status === "missing" || reserved.status === "expired") {
    throw new SimulationServiceError(
      "simulation_session_expired",
      "The simulation session expired. Start again.",
      410,
    );
  }
  if (reserved.status === "revision_conflict") {
    throw new SimulationServiceError(
      "simulation_revision_conflict",
      "This turn is stale. Reconcile the current session before continuing.",
      409,
    );
  }
  if (reserved.status === "turn_in_progress") {
    throw new SimulationServiceError(
      "simulation_turn_in_progress",
      "A turn is already being resolved.",
      409,
    );
  }
  if (reserved.status !== "reserved") {
    throw new SimulationServiceError(
      "simulation_unavailable",
      "The simulation service is temporarily unavailable.",
      503,
    );
  }
  const session = reserved.session;
  if (
    session.status !== "active" ||
    session.sceneId !== turn.sceneId ||
    session.turnCount >= MAX_TURNS ||
    (turn.freeText && session.freeTextTurns >= MAX_FREE_TEXT_TURNS)
  ) {
    await releaseSimulationTurn(
      database,
      session.sessionHash,
      session.revision,
      turn.requestId,
    );
    throw new SimulationServiceError(
      "simulation_turn_not_allowed",
      "This turn is not available in the current campaign state.",
      409,
    );
  }

  const facts = activeGrounding.factCards;
  const entityIds = [...activeGrounding.allowedEntityIds];
  const grounding = providerGroundingForAction(turn.actionId);
  let approvedForModel = false;
  if (grounding) {
    try {
      approvedForModel = await providerApprovedForSimulationModel(
        grounding.provider,
        new Date(),
        database,
      );
    } catch {
      approvedForModel = false;
    }
  }
  const providerSummary =
    turn.sceneId === "act-3" && grounding
      ? await resolveSimulationPlayGrounding({
          sceneId: turn.sceneId,
          provider: grounding.provider,
          approvedForGameAndModel: approvedForModel,
          database,
        })
      : null;

  let source: SimulationTurnResponse["source"] = "authored_fallback";
  const authored = authoredFallback(turn.sceneId, turn.actionId);
  let opponent: ModelTurnOutput = {
    ...authored,
    revealEntityIds: authored.revealEntityIds.filter((id) =>
      activeGrounding.allowedEntityIds.has(id),
    ),
  };
  let usedProvider = false;
  const provider = reserved.skipProvider ? null : simulationDialogueProvider();
  let modelBudgetAvailable = true;
  if (
    provider?.source === "generated" &&
    facts.length > 0 &&
    session.generationCalls < MAX_GENERATION_CALLS
  ) {
    modelBudgetAvailable = await claimSimulationDailyBudget(
      database,
      simulationDailyModelLimit(),
    );
  }
  if (
    provider &&
    facts.length > 0 &&
    modelBudgetAvailable &&
    session.generationCalls < MAX_GENERATION_CALLS
  ) {
    usedProvider = true;
    const resolved = await resolveSimulationProviderTurn({
      provider,
      sceneId: turn.sceneId,
      eligibleEntities: activeGrounding.allowedEntityIds,
      authored: opponent,
      groundedInput: {
        sceneId: turn.sceneId,
        actionId: turn.actionId,
        ...(turn.freeText ? { freeText: turn.freeText } : {}),
        facts,
        allowedEntityIds: entityIds,
        visitorSignals: session.state.visitorSignals,
        curiosity: session.state.curiosity,
        providerGrounding: grounding
          ? {
              provider: grounding.provider,
              label: grounding.label,
              approvedForModel: Boolean(providerSummary),
              summary: providerSummary,
            }
          : null,
      },
    });
    opponent = resolved.opponent;
    source = resolved.source;
  }
  if (source === "authored_fallback") {
    await recordSimulationFallback(database);
  } else if (source === "generated") {
    await recordSimulationGenerationSuccess(database);
  }

  const nextSceneId = nextSimulationScene(turn.sceneId);
  const nextState = deterministicState(
    session,
    turn,
    opponent,
    activeGrounding.visibleEntityIds,
  );
  const projected = projectedNextSession(session, nextSceneId, nextState, {
    usedFreeText: Boolean(turn.freeText),
    usedProvider,
  });
  const response: SimulationTurnResponse = {
    revision: projected.revision,
    source,
    opponent,
    factCards: factCardsForGroundedEntities(
      bundle,
      turn.sceneId,
      opponent.revealEntityIds,
    ),
    nextActions: trustedActions(nextSceneId),
    session: publicSimulationSession(projected),
  };
  const completed = await completeSimulationTurn(database, {
    session,
    requestId: turn.requestId,
    nextSceneId,
    nextState,
    response,
    usedFreeText: Boolean(turn.freeText),
    usedProvider,
  });
  if (!completed) {
    throw new SimulationServiceError(
      "simulation_revision_conflict",
      "The campaign changed while this turn was resolving.",
      409,
    );
  }
  return response;
}

export function simulationServiceMetadata() {
  return {
    campaignVersion: SIMULATION_CAMPAIGN_VERSION,
    maximumTurns: MAX_TURNS,
    maximumFreeTextTurns: MAX_FREE_TEXT_TURNS,
    maximumGeneratedBeats: MAX_GENERATION_CALLS,
  } as const;
}
