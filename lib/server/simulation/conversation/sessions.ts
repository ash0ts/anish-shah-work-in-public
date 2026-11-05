import { z } from "zod";
import {
  CONVERSATION_VERSION,
  conversationScene,
  CONVERSATION_LIMITS,
} from "@/lib/simulation/conversation-contract";
import { ConversationError } from "./settings";

const id = z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,127}$/);
const safeState = z
  .object({
    version: z.literal(CONVERSATION_VERSION),
    inspectedIds: z.array(id).max(3),
    seenRequests: z.array(z.string().uuid()).max(100),
    lastSourceIds: z.array(id).max(3),
  })
  .strict();
type SafeState = z.infer<typeof safeState>;
export type ConversationSession = {
  hash: string;
  revision: number;
  calls: number;
  state: SafeState;
  pending: string | null;
  lease: string | null;
  expiresAt: string;
};
type Row = {
  campaignVersion: string;
  revision: number;
  generationCalls: number;
  safeStateJson: string;
  pendingRequestId: string | null;
  generationLeaseUntil: string | null;
  expiresAt: string;
};

export async function createConversationSession(
  database: D1Database,
  hash: string,
  now = new Date(),
) {
  const state: SafeState = {
    version: CONVERSATION_VERSION,
    inspectedIds: [],
    seenRequests: [],
    lastSourceIds: [],
  };
  await database
    .prepare(
      `INSERT INTO simulation_sessions (session_hash, campaign_version, status, revision, scene_id, safe_state_json, free_text_turns, generation_calls, turn_count, created_at, updated_at, expires_at)
    VALUES (?, ?, 'active', 0, 'desk', ?, 0, 0, 0, ?, ?, ?)`,
    )
    .bind(
      hash,
      CONVERSATION_VERSION,
      JSON.stringify(state),
      now.toISOString(),
      now.toISOString(),
      new Date(
        now.getTime() + CONVERSATION_LIMITS.sessionMilliseconds,
      ).toISOString(),
    )
    .run();
}
export async function readConversationSession(
  database: D1Database,
  hash: string,
  now = new Date(),
): Promise<ConversationSession> {
  const row = await database
    .prepare(
      `SELECT campaign_version AS campaignVersion, revision, generation_calls AS generationCalls, safe_state_json AS safeStateJson,
    pending_request_id AS pendingRequestId, generation_lease_until AS generationLeaseUntil, expires_at AS expiresAt FROM simulation_sessions WHERE session_hash = ? LIMIT 1`,
    )
    .bind(hash)
    .first<Row>();
  if (
    !row ||
    row.campaignVersion !== CONVERSATION_VERSION ||
    !Number.isFinite(Date.parse(row.expiresAt)) ||
    Date.parse(row.expiresAt) <= now.getTime()
  )
    throw new ConversationError("restart_required", 410);
  let state: SafeState;
  try {
    state = safeState.parse(JSON.parse(row.safeStateJson));
  } catch {
    throw new ConversationError("restart_required", 410);
  }
  if (
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    row.revision > 100 ||
    !Number.isSafeInteger(row.generationCalls) ||
    row.generationCalls < 0 ||
    row.generationCalls > 20
  )
    throw new ConversationError("restart_required", 410);
  return {
    hash,
    revision: row.revision,
    calls: row.generationCalls,
    state,
    pending: row.pendingRequestId,
    lease: row.generationLeaseUntil,
    expiresAt: row.expiresAt,
  };
}
export async function reserveConversationTurn(
  database: D1Database,
  session: ConversationSession,
  requestId: string,
  expectedRevision: number,
  now = new Date(),
) {
  if (session.state.seenRequests.includes(requestId))
    return { replay: true as const, session };
  if (session.revision !== expectedRevision)
    throw new ConversationError("revision_conflict", 409);
  if (session.state.seenRequests.length >= 100)
    throw new ConversationError("restart_required", 410);
  const state = {
    ...session.state,
    seenRequests: [...session.state.seenRequests, requestId],
  };
  const lease = new Date(now.getTime() + 15_000).toISOString();
  const result = await database
    .prepare(
      `UPDATE simulation_sessions SET pending_request_id = ?, generation_lease_until = ?, safe_state_json = ?, updated_at = ?
    WHERE session_hash = ? AND campaign_version = ? AND revision = ? AND safe_state_json = ? AND expires_at > ?
    AND (generation_lease_until IS NULL OR generation_lease_until <= ?)`,
    )
    .bind(
      requestId,
      lease,
      JSON.stringify(state),
      now.toISOString(),
      session.hash,
      CONVERSATION_VERSION,
      expectedRevision,
      JSON.stringify(session.state),
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  if (result.meta.changes !== 1)
    throw new ConversationError("turn_in_progress", 409);
  return {
    replay: false as const,
    session: { ...session, state, pending: requestId, lease },
  };
}
export async function claimConversationCall(
  database: D1Database,
  session: ConversationSession,
) {
  const result = await database
    .prepare(
      `UPDATE simulation_sessions SET generation_calls = generation_calls + 1
    WHERE session_hash = ? AND campaign_version = ? AND revision = ? AND pending_request_id = ? AND generation_calls = ? AND generation_calls < 20 AND generation_lease_until > ?`,
    )
    .bind(
      session.hash,
      CONVERSATION_VERSION,
      session.revision,
      session.pending,
      session.calls,
      new Date().toISOString(),
    )
    .run();
  return result.meta.changes === 1;
}
export async function completeConversationTurn(
  database: D1Database,
  session: ConversationSession,
  sourceIds: string[],
  inspectedIds: string[],
) {
  const state: SafeState = {
    ...session.state,
    lastSourceIds: sourceIds,
    inspectedIds,
  };
  const result = await database
    .prepare(
      `UPDATE simulation_sessions SET revision = revision + 1, scene_id = ?, safe_state_json = ?, turn_count = turn_count + 1,
    pending_request_id = NULL, generation_lease_until = NULL, last_request_id = ?, last_response_json = NULL, updated_at = ?
    WHERE session_hash = ? AND campaign_version = ? AND revision = ? AND pending_request_id = ? AND expires_at > ? AND generation_lease_until > ?`,
    )
    .bind(
      conversationScene(inspectedIds),
      JSON.stringify(state),
      session.pending,
      new Date().toISOString(),
      session.hash,
      CONVERSATION_VERSION,
      session.revision,
      session.pending,
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  if (result.meta.changes !== 1)
    throw new ConversationError("revision_conflict", 409);
}
