import {
  SIMULATION_CAMPAIGN_VERSION,
  SIMULATION_CURIOSITIES,
  SIMULATION_DIFFICULTIES,
  SIMULATION_MODES,
  SIMULATION_RESPONSE_MODES,
  SIMULATION_SCENE_IDS,
  SIMULATION_VISITOR_SIGNALS,
  type SimulationSafeState,
  type SimulationSceneId,
  type SimulationTurnResponse,
} from "./contracts";
import { isAllowedSimulationAction } from "./policy";
import { validateModelTurnOutput } from "./validation";

export type SessionRow = {
  sessionHash: string;
  campaignVersion: string;
  status: string;
  revision: number;
  sceneId: string;
  safeStateJson: string;
  freeTextTurns: number;
  generationCalls: number;
  turnCount: number;
  pendingRequestId: string | null;
  generationLeaseUntil: string | null;
  lastRequestId: string | null;
  lastResponseJson: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type StoredSimulationSession = {
  sessionHash: string;
  campaignVersion: typeof SIMULATION_CAMPAIGN_VERSION;
  status: "active" | "complete";
  revision: number;
  sceneId: SimulationSceneId;
  state: SimulationSafeState;
  freeTextTurns: number;
  generationCalls: number;
  turnCount: number;
  pendingRequestId: string | null;
  generationLeaseUntil: string | null;
  lastRequestId: string | null;
  lastResponse: SimulationTurnResponse | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type SimulationTurnReservation =
  | {
      status: "reserved";
      session: StoredSimulationSession;
      skipProvider: boolean;
    }
  | { status: "idempotent"; response: SimulationTurnResponse }
  | { status: "missing" | "expired" | "revision_conflict" | "turn_in_progress" };

export const SESSION_COLUMNS = `
  session_hash AS sessionHash, campaign_version AS campaignVersion,
  status, revision, scene_id AS sceneId, safe_state_json AS safeStateJson,
  free_text_turns AS freeTextTurns, generation_calls AS generationCalls,
  turn_count AS turnCount, pending_request_id AS pendingRequestId,
  generation_lease_until AS generationLeaseUntil,
  last_request_id AS lastRequestId, last_response_json AS lastResponseJson,
  created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt
`;

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

const STORED_IDENTIFIER = /^[a-z0-9][a-z0-9:._-]{0,127}$/;
const STORED_INTERNAL_ROUTE = /^\/(?:work|play)\/[a-z0-9][a-z0-9/_-]{0,255}$/;
const STORED_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key))
  );
}

function storedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !STORED_CONTROL_CHARACTER.test(value)
  );
}

function storedIdentifiers(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(
      (entry) => typeof entry === "string" && STORED_IDENTIFIER.test(entry),
    ) &&
    new Set(value).size === value.length
  );
}

function parseSafeState(value: string): SimulationSafeState | null {
  let state: unknown;
  try {
    state = JSON.parse(value);
  } catch {
    return null;
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const record = state as Record<string, unknown>;
  const keys = new Set([
    "mode",
    "difficulty",
    "curiosity",
    "score",
    "visitorSignals",
    "revealedEntityIds",
    "selectedPlayRoute",
  ]);
  const score = record.score;
  if (
    Object.keys(record).length !== keys.size ||
    Object.keys(record).some((key) => !keys.has(key)) ||
    !SIMULATION_MODES.includes(record.mode as (typeof SIMULATION_MODES)[number]) ||
    !SIMULATION_DIFFICULTIES.includes(
      record.difficulty as (typeof SIMULATION_DIFFICULTIES)[number],
    ) ||
    !SIMULATION_CURIOSITIES.includes(
      record.curiosity as (typeof SIMULATION_CURIOSITIES)[number],
    ) ||
    !score ||
    typeof score !== "object" ||
    Array.isArray(score) ||
    !integer((score as Record<string, unknown>).signalFound, 0, 12) ||
    !integer((score as Record<string, unknown>).claimsGrounded, 0, 12) ||
    !integer((score as Record<string, unknown>).curiosityFollowed, 0, 12) ||
    !Array.isArray(record.visitorSignals) ||
    record.visitorSignals.length > SIMULATION_VISITOR_SIGNALS.length ||
    !record.visitorSignals.every((signal) =>
      SIMULATION_VISITOR_SIGNALS.includes(
        signal as (typeof SIMULATION_VISITOR_SIGNALS)[number],
      ),
    ) ||
    new Set(record.visitorSignals).size !== record.visitorSignals.length ||
    !Array.isArray(record.revealedEntityIds) ||
    record.revealedEntityIds.length > 16 ||
    !record.revealedEntityIds.every(
      (id) => typeof id === "string" && STORED_IDENTIFIER.test(id),
    ) ||
    new Set(record.revealedEntityIds).size !== record.revealedEntityIds.length ||
    !(
      record.selectedPlayRoute === null ||
      (typeof record.selectedPlayRoute === "string" &&
        /^\/play\/(?:watch|read|listen|collect|play|move)$/.test(
          record.selectedPlayRoute,
        ))
    )
  ) {
    return null;
  }
  return record as unknown as SimulationSafeState;
}

function parseStoredResponse(value: string | null): SimulationTurnResponse | null {
  if (!value || value.length > 16_384) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !exactRecord(parsed, [
        "revision",
        "source",
        "opponent",
        "factCards",
        "nextActions",
        "session",
      ])
    ) {
      return null;
    }
    const response = parsed as Record<string, unknown>;
    if (
      !integer(response.revision, 1, 12) ||
      !["generated", "fixture", "authored_fallback"].includes(
        String(response.source),
      ) ||
      !exactRecord(response.opponent, [
        "opponentLine",
        "responseMode",
        "revealEntityIds",
        "visitorSignals",
      ]) ||
      !storedIdentifiers(response.opponent.revealEntityIds, 2)
    ) {
      return null;
    }
    const opponent = validateModelTurnOutput(
      response.opponent,
      "act-1",
      new Set(response.opponent.revealEntityIds),
    );
    if (!opponent || !SIMULATION_RESPONSE_MODES.includes(opponent.responseMode)) {
      return null;
    }

    if (!Array.isArray(response.factCards) || response.factCards.length > 2) {
      return null;
    }
    const factCards = response.factCards.flatMap((value) => {
      if (
        !exactRecord(value, [
          "id",
          "statement",
          "qualifier",
          "href",
          "evidenceIds",
        ]) ||
        typeof value.id !== "string" ||
        !STORED_IDENTIFIER.test(value.id) ||
        !storedText(value.statement, 640) ||
        !(value.qualifier === null || storedText(value.qualifier, 320)) ||
        !(
          value.href === null ||
          (typeof value.href === "string" && STORED_INTERNAL_ROUTE.test(value.href))
        ) ||
        !storedIdentifiers(value.evidenceIds, 32)
      ) {
        return [];
      }
      return [
        {
          id: value.id,
          statement: value.statement,
          qualifier: value.qualifier as string | null,
          href: value.href as string | null,
          evidenceIds: [...value.evidenceIds],
        },
      ];
    });
    if (factCards.length !== response.factCards.length) return null;

    if (!Array.isArray(response.nextActions) || response.nextActions.length > 6) {
      return null;
    }
    const nextActions = response.nextActions.flatMap((value) => {
      if (
        !exactRecord(value, ["id", "sceneId"]) ||
        typeof value.id !== "string" ||
        typeof value.sceneId !== "string" ||
        value.sceneId === "complete" ||
        !SIMULATION_SCENE_IDS.includes(
          value.sceneId as (typeof SIMULATION_SCENE_IDS)[number],
        ) ||
        !isAllowedSimulationAction(
          value.sceneId as SimulationSceneId,
          value.id,
        )
      ) {
        return [];
      }
      return [
        {
          id: value.id,
          sceneId: value.sceneId as Exclude<SimulationSceneId, "complete">,
        },
      ];
    });
    if (nextActions.length !== response.nextActions.length) return null;

    if (
      !exactRecord(response.session, [
        "campaignVersion",
        "status",
        "revision",
        "sceneId",
        "state",
        "remainingFreeTextTurns",
        "remainingGeneratedBeats",
        "expiresAt",
      ])
    ) {
      return null;
    }
    const session = response.session;
    const state = parseSafeState(JSON.stringify(session.state));
    if (
      session.campaignVersion !== SIMULATION_CAMPAIGN_VERSION ||
      !["active", "complete"].includes(String(session.status)) ||
      session.revision !== response.revision ||
      typeof session.sceneId !== "string" ||
      !SIMULATION_SCENE_IDS.includes(
        session.sceneId as (typeof SIMULATION_SCENE_IDS)[number],
      ) ||
      !state ||
      !integer(session.remainingFreeTextTurns, 0, 2) ||
      !integer(session.remainingGeneratedBeats, 0, 4) ||
      !canonicalTimestamp(session.expiresAt)
    ) {
      return null;
    }

    return {
      revision: response.revision,
      source: response.source as SimulationTurnResponse["source"],
      opponent,
      factCards,
      nextActions,
      session: {
        campaignVersion: SIMULATION_CAMPAIGN_VERSION,
        status: session.status as "active" | "complete",
        revision: session.revision,
        sceneId: session.sceneId as SimulationSceneId,
        state,
        remainingFreeTextTurns: session.remainingFreeTextTurns,
        remainingGeneratedBeats: session.remainingGeneratedBeats,
        expiresAt: session.expiresAt,
      },
    };
  } catch {
    return null;
  }
}

export function parseSimulationSessionRow(
  row: SessionRow | null,
): StoredSimulationSession | null {
  if (!row) return null;
  const state = parseSafeState(row.safeStateJson);
  if (
    row.campaignVersion !== SIMULATION_CAMPAIGN_VERSION ||
    !["active", "complete"].includes(row.status) ||
    !integer(row.revision, 0, 12) ||
    !SIMULATION_SCENE_IDS.includes(
      row.sceneId as (typeof SIMULATION_SCENE_IDS)[number],
    ) ||
    !state ||
    !integer(row.freeTextTurns, 0, 2) ||
    !integer(row.generationCalls, 0, 4) ||
    !integer(row.turnCount, 0, 12) ||
    !canonicalTimestamp(row.createdAt) ||
    !canonicalTimestamp(row.updatedAt) ||
    !canonicalTimestamp(row.expiresAt) ||
    !(
      row.generationLeaseUntil === null ||
      canonicalTimestamp(row.generationLeaseUntil)
    )
  ) {
    return null;
  }
  return {
    sessionHash: row.sessionHash,
    campaignVersion: SIMULATION_CAMPAIGN_VERSION,
    status: row.status as "active" | "complete",
    revision: row.revision,
    sceneId: row.sceneId as SimulationSceneId,
    state,
    freeTextTurns: row.freeTextTurns,
    generationCalls: row.generationCalls,
    turnCount: row.turnCount,
    pendingRequestId: row.pendingRequestId,
    generationLeaseUntil: row.generationLeaseUntil,
    lastRequestId: row.lastRequestId,
    lastResponse: parseStoredResponse(row.lastResponseJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}
