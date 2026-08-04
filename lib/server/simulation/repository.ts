import {
  SIMULATION_CAMPAIGN_VERSION,
  SIMULATION_CURIOSITIES,
  SIMULATION_DIFFICULTIES,
  SIMULATION_MODES,
  SIMULATION_RESPONSE_MODES,
  SIMULATION_SCENE_IDS,
  SIMULATION_VISITOR_SIGNALS,
  type CreateSimulationSessionInput,
  type SimulationSafeState,
  type SimulationSceneId,
  type SimulationSessionPublic,
  type SimulationTurnResponse,
} from "./contracts";
import { isAllowedSimulationAction } from "./policy";
import { validateModelTurnOutput } from "./validation";

const SESSION_WINDOW_MS = 60 * 60 * 1_000;
const GENERATION_LEASE_MS = 12_000;
const SESSION_RETENTION_MS = 2 * 60 * 60 * 1_000;
const BUDGET_RETENTION_DAYS = 90;

type SessionRow = {
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

type ReserveTurnResult =
  | { status: "reserved"; session: StoredSimulationSession; skipProvider: boolean }
  | { status: "idempotent"; response: SimulationTurnResponse }
  | { status: "missing" | "expired" | "revision_conflict" | "turn_in_progress" };

const SESSION_COLUMNS = `
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
      (id) => typeof id === "string" && /^[a-z0-9][a-z0-9:._-]{0,127}$/.test(id),
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
        !(
          value.qualifier === null ||
          storedText(value.qualifier, 320)
        ) ||
        !(
          value.href === null ||
          (typeof value.href === "string" &&
            STORED_INTERNAL_ROUTE.test(value.href))
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

function parseSessionRow(row: SessionRow | null): StoredSimulationSession | null {
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
    !(row.generationLeaseUntil === null || canonicalTimestamp(row.generationLeaseUntil))
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

export function publicSimulationSession(
  session: StoredSimulationSession,
): SimulationSessionPublic {
  return {
    campaignVersion: SIMULATION_CAMPAIGN_VERSION,
    status: session.status,
    revision: session.revision,
    sceneId: session.sceneId,
    state: session.state,
    remainingFreeTextTurns: Math.max(0, 2 - session.freeTextTurns),
    remainingGeneratedBeats: Math.max(0, 4 - session.generationCalls),
    expiresAt: session.expiresAt,
  };
}

export async function createSimulationSession(
  database: D1Database,
  sessionHash: string,
  input: CreateSimulationSessionInput,
  now = new Date(),
): Promise<StoredSimulationSession> {
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_WINDOW_MS).toISOString();
  const state: SimulationSafeState = {
    ...input,
    score: { signalFound: 0, claimsGrounded: 0, curiosityFollowed: 0 },
    visitorSignals: [],
    revealedEntityIds: [],
    selectedPlayRoute: null,
  };
  await database
    .prepare(
      `INSERT INTO simulation_sessions (
         session_hash, campaign_version, status, revision, scene_id,
         safe_state_json, free_text_turns, generation_calls, turn_count,
         created_at, updated_at, expires_at
       ) VALUES (?, ?, 'active', 0, 'act-1', ?, 0, 0, 0, ?, ?, ?)`,
    )
    .bind(
      sessionHash,
      SIMULATION_CAMPAIGN_VERSION,
      JSON.stringify(state),
      createdAt,
      createdAt,
      expiresAt,
    )
    .run();
  const session = await getSimulationSession(database, sessionHash, now);
  if (!session) throw new Error("simulation_session_create_failed");
  return session;
}

export async function getSimulationSession(
  database: D1Database,
  sessionHash: string,
  now = new Date(),
): Promise<StoredSimulationSession | null> {
  const row = await database
    .prepare(
      `SELECT ${SESSION_COLUMNS}
       FROM simulation_sessions
       WHERE session_hash = ?
       LIMIT 1`,
    )
    .bind(sessionHash)
    .first<SessionRow>();
  const session = parseSessionRow(row);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= now.getTime()) {
    await deleteSimulationSession(database, sessionHash);
    return null;
  }
  return session;
}

export async function deleteSimulationSession(
  database: D1Database,
  sessionHash: string,
): Promise<void> {
  await database
    .prepare(`DELETE FROM simulation_sessions WHERE session_hash = ?`)
    .bind(sessionHash)
    .run();
}

export async function reserveSimulationTurn(
  database: D1Database,
  sessionHash: string,
  expectedRevision: number,
  requestId: string,
  now = new Date(),
): Promise<ReserveTurnResult> {
  const session = await getSimulationSession(database, sessionHash, now);
  if (!session) return { status: "missing" };
  if (session.lastRequestId === requestId && session.lastResponse) {
    return { status: "idempotent", response: session.lastResponse };
  }
  if (session.revision !== expectedRevision) return { status: "revision_conflict" };
  const leaseActive = Boolean(
    session.generationLeaseUntil &&
      Date.parse(session.generationLeaseUntil) > now.getTime(),
  );
  if (leaseActive) return { status: "turn_in_progress" };
  const skipProvider = session.pendingRequestId === requestId;
  const leaseUntil = new Date(now.getTime() + GENERATION_LEASE_MS).toISOString();
  const result = await database
    .prepare(
      `UPDATE simulation_sessions
       SET pending_request_id = ?, generation_lease_until = ?, updated_at = ?
       WHERE session_hash = ? AND revision = ? AND status = 'active'
         AND expires_at > ?
         AND (generation_lease_until IS NULL OR generation_lease_until <= ?)`,
    )
    .bind(
      requestId,
      leaseUntil,
      now.toISOString(),
      sessionHash,
      expectedRevision,
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) return { status: "turn_in_progress" };
  return { status: "reserved", session, skipProvider };
}

export async function completeSimulationTurn(
  database: D1Database,
  input: {
    session: StoredSimulationSession;
    requestId: string;
    nextSceneId: SimulationSceneId;
    nextState: SimulationSafeState;
    response: SimulationTurnResponse;
    usedFreeText: boolean;
    usedProvider: boolean;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const result = await database
    .prepare(
      `UPDATE simulation_sessions
       SET status = ?, revision = ?, scene_id = ?, safe_state_json = ?,
           free_text_turns = free_text_turns + ?,
           generation_calls = generation_calls + ?,
           turn_count = turn_count + 1,
           pending_request_id = NULL, generation_lease_until = NULL,
           last_request_id = ?, last_response_json = ?, updated_at = ?
       WHERE session_hash = ? AND revision = ? AND status = 'active'
         AND pending_request_id = ? AND expires_at > ?`,
    )
    .bind(
      input.nextSceneId === "complete" ? "complete" : "active",
      input.session.revision + 1,
      input.nextSceneId,
      JSON.stringify(input.nextState),
      input.usedFreeText ? 1 : 0,
      input.usedProvider ? 1 : 0,
      input.requestId,
      JSON.stringify(input.response),
      now.toISOString(),
      input.session.sessionHash,
      input.session.revision,
      input.requestId,
      now.toISOString(),
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function releaseSimulationTurn(
  database: D1Database,
  sessionHash: string,
  revision: number,
  requestId: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE simulation_sessions
       SET pending_request_id = NULL, generation_lease_until = NULL,
           updated_at = ?
       WHERE session_hash = ? AND revision = ? AND pending_request_id = ?`,
    )
    .bind(new Date().toISOString(), sessionHash, revision, requestId)
    .run();
}

export async function claimSimulationDailyBudget(
  database: D1Database,
  limit: number,
  now = new Date(),
): Promise<boolean> {
  const date = now.toISOString().slice(0, 10);
  const result = await database
    .prepare(
      `INSERT INTO simulation_daily_budget (
         budget_date, model_calls, authored_fallbacks, updated_at
       ) VALUES (?, 1, 0, ?)
       ON CONFLICT(budget_date) DO UPDATE SET
         model_calls = model_calls + 1,
         updated_at = excluded.updated_at
       WHERE model_calls < ?`,
    )
    .bind(date, now.toISOString(), limit)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function recordSimulationFallback(
  database: D1Database,
  now = new Date(),
): Promise<void> {
  const date = now.toISOString().slice(0, 10);
  await database
    .prepare(
      `INSERT INTO simulation_daily_budget (
         budget_date, model_calls, authored_fallbacks, updated_at
       ) VALUES (?, 0, 1, ?)
       ON CONFLICT(budget_date) DO UPDATE SET
         authored_fallbacks = authored_fallbacks + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(date, now.toISOString())
    .run();
}

export async function recordSimulationGenerationSuccess(
  database: D1Database,
  now = new Date(),
): Promise<void> {
  const checkedAt = now.toISOString();
  await database
    .prepare(
      `INSERT INTO maintenance_state (
         key, status, details_json, checked_at, updated_at
       ) VALUES ('simulation_generation', 'healthy', '{"provider":"anthropic"}', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         status = excluded.status,
         details_json = excluded.details_json,
         checked_at = excluded.checked_at,
         updated_at = excluded.updated_at`,
    )
    .bind(checkedAt, checkedAt)
    .run();
}

export async function pruneSimulationRetention(
  database: D1Database,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const sessionCutoff = new Date(
    now.getTime() - SESSION_RETENTION_MS,
  ).toISOString();
  const budgetCutoff = new Date(now);
  budgetCutoff.setUTCDate(budgetCutoff.getUTCDate() - BUDGET_RETENTION_DAYS);
  await database.batch([
    database
      .prepare(
        `DELETE FROM simulation_sessions
         WHERE expires_at <= ? OR updated_at <= ?`,
      )
      .bind(nowIso, sessionCutoff),
    database
      .prepare(`DELETE FROM simulation_daily_budget WHERE budget_date < ?`)
      .bind(budgetCutoff.toISOString().slice(0, 10)),
  ]);
}
