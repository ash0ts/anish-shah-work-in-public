import {
  CONVERSATION_LIMITS,
  CONVERSATION_VERSION,
  conversationScene,
  searchConversationSources,
  type ConversationReply,
  type ConversationSource,
} from "@/lib/simulation/conversation-contract";
import { getPublicContentView } from "../../public-content";
import { runtimeValue } from "../../runtime-env";
import {
  claimSimulationDailyBudget,
  recordSimulationFallback,
  recordSimulationGenerationSuccess,
} from "../budget-repository";
import {
  createSimulationSessionToken,
  hashSimulationSessionToken,
  simulationSessionTokenFromRequest,
  validSimulationSessionHmacKey,
} from "../session-crypto";
import { approvedCollectionSources } from "./collections";
import { conversationSources } from "./grounding";
import { selectGeminiEvidence } from "./provider";
import {
  conversationInputAllowed,
  conversationSourceAllowed,
} from "./screening";
import {
  claimConversationCall,
  completeConversationTurn,
  createConversationSession,
  readConversationSession,
  reserveConversationTurn,
} from "./sessions";
import {
  conversationDatabase,
  ConversationError,
  decryptGeminiKey,
  readGeminiConfiguration,
} from "./settings";

export async function activeConversationSources(): Promise<
  ConversationSource[]
> {
  const { bundle } = await getPublicContentView();
  return [
    ...conversationSources(bundle),
    ...(await approvedCollectionSources()),
  ].filter((source) =>
    conversationSourceAllowed(
      [source.title, source.text, source.limit ?? ""].join(" "),
    ),
  );
}

function hmacKey() {
  const key = runtimeValue("SIMULATION_SESSION_HMAC_KEY");
  if (!validSimulationSessionHmacKey(key))
    throw new ConversationError("setup_required", 503);
  return key as string;
}
async function sessionHash(request: Request) {
  const token = simulationSessionTokenFromRequest(request);
  if (!token) throw new ConversationError("restart_required", 410);
  return hashSimulationSessionToken(token, hmacKey());
}
export async function startConversation(request: Request) {
  const database = conversationDatabase();
  const previous = simulationSessionTokenFromRequest(request);
  if (previous) {
    const hash = await hashSimulationSessionToken(previous, hmacKey());
    await database
      .prepare("DELETE FROM simulation_sessions WHERE session_hash = ?")
      .bind(hash)
      .run();
  }
  const token = createSimulationSessionToken();
  await createConversationSession(
    database,
    await hashSimulationSessionToken(token, hmacKey()),
  );
  return { token, revision: 0 };
}
export async function endConversation(request: Request) {
  const hash = await sessionHash(request);
  await conversationDatabase()
    .prepare("DELETE FROM simulation_sessions WHERE session_hash = ?")
    .bind(hash)
    .run();
}
export async function currentConversation(request: Request) {
  const session = await readConversationSession(
    conversationDatabase(),
    await sessionHash(request),
  );
  const ids = new Set(
    (await activeConversationSources()).map((source) => source.id),
  );
  return {
    version: CONVERSATION_VERSION,
    revision: session.revision,
    inspectedIds: session.state.inspectedIds.filter((id) => ids.has(id)),
    expiresAt: session.expiresAt,
  };
}

export type ConversationTurn = {
  requestId: string;
  message: string;
  inspectId: string | null;
};
export async function submitConversation(
  request: Request,
  turn: ConversationTurn,
  expectedRevision: number,
): Promise<ConversationReply> {
  const database = conversationDatabase();
  const current = await readConversationSession(
    database,
    await sessionHash(request),
  );
  const catalog = await activeConversationSources();
  const byId = new Map(catalog.map((source) => [source.id, source]));
  // SSR choices and returned cards must still exist in the current visible catalog.
  if (turn.inspectId && !byId.has(turn.inspectId))
    throw new ConversationError("source_unavailable", 409);
  const { session, replay } = await reserveConversationTurn(
    database,
    current,
    turn.requestId,
    expectedRevision,
  );
  if (
    replay &&
    session.pending === turn.requestId &&
    session.lease &&
    Date.parse(session.lease) > Date.now()
  )
    throw new ConversationError("turn_in_progress", 409);
  let selected: string[] = [];
  let source: ConversationReply["source"] = replay ? "replayed" : "archive";
  let status: ConversationReply["status"] = "answered";
  if (replay || turn.inspectId) {
    selected = session.state.lastSourceIds.length
      ? session.state.lastSourceIds
      : turn.inspectId
        ? [turn.inspectId]
        : [];
  } else if (!conversationInputAllowed(turn.message)) {
    status = "screened";
  } else {
    const candidates = searchConversationSources(catalog, turn.message).slice(
      0,
      CONVERSATION_LIMITS.sourceCount,
    );
    selected = candidates
      .slice(0, CONVERSATION_LIMITS.responseCards)
      .map((card) => card.id);
    if (!selected.length) status = "no_evidence";
    else {
      const config = await readGeminiConfiguration();
      const key =
        config.enabled && config.tested ? await decryptGeminiKey(config) : null;
      if (key) {
        const sessionBudget = await claimConversationCall(database, session);
        const dailyBudget =
          sessionBudget &&
          (await claimSimulationDailyBudget(
            database,
            CONVERSATION_LIMITS.dailyCalls,
          ));
        if (!dailyBudget) status = "budget";
        else {
          try {
            const result = await selectGeminiEvidence(
              key,
              turn.message,
              candidates,
              AbortSignal.timeout(CONVERSATION_LIMITS.deadlineMilliseconds),
            );
            if (result === null) status = "unavailable";
            else {
              selected = result;
              source = "gemini";
              if (!result.length) status = "no_evidence";
            }
          } catch {
            status = "unavailable";
          }
        }
      }
    }
  }
  // Reproject after generation: revocation or hiding during a request wins.
  const fresh = await activeConversationSources();
  const freshById = new Map(fresh.map((card) => [card.id, card]));
  const cards = selected
    .flatMap((id) => (freshById.has(id) ? [freshById.get(id)!] : []))
    .slice(0, CONVERSATION_LIMITS.responseCards);
  const inspectedIds = [
    ...new Set([
      ...session.state.inspectedIds,
      ...(!replay && turn.inspectId ? [turn.inspectId] : []),
    ]),
  ]
    .filter((id) => freshById.has(id))
    .slice(0, 3);
  if (!replay)
    await completeConversationTurn(
      database,
      session,
      cards.map((card) => card.id),
      inspectedIds,
    );
  if (!replay && !turn.inspectId) {
    try {
      if (source === "gemini")
        await recordSimulationGenerationSuccess(database);
      else await recordSimulationFallback(database);
    } catch {
      /* Coarse telemetry must not fail a completed turn or expose its text. */
    }
  }
  return {
    version: CONVERSATION_VERSION,
    revision: session.revision + (replay ? 0 : 1),
    source,
    scene: conversationScene(inspectedIds),
    inspectedIds,
    visibleIds: fresh.map((card) => card.id),
    cards,
    status,
  };
}
