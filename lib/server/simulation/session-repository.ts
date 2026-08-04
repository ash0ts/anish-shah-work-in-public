import {
  SIMULATION_CAMPAIGN_VERSION,
  type CreateSimulationSessionInput,
  type SimulationSafeState,
  type SimulationSceneId,
  type SimulationSessionPublic,
  type SimulationTurnResponse,
} from "./contracts";
import {
  SESSION_COLUMNS,
  parseSimulationSessionRow,
  type SessionRow,
  type SimulationTurnReservation,
  type StoredSimulationSession,
} from "./session-records";

const SESSION_WINDOW_MS = 60 * 60 * 1_000;
const GENERATION_LEASE_MS = 12_000;

export type { StoredSimulationSession } from "./session-records";

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
  const session = parseSimulationSessionRow(row);
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
): Promise<SimulationTurnReservation> {
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
