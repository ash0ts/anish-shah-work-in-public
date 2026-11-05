import {
  CONVERSATION_LIMITS,
  CONVERSATION_VERSION,
  conversationScene,
  searchConversationSources,
  type ConversationReply,
  type ConversationSource,
  type RecentTurn,
} from "@/lib/simulation/conversation-contract";
import { getPublicContentView } from "../../public-content";
import { runtimeValue } from "../../runtime-env";
import { authorizeOwnerApi } from "../../owner-auth";
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
import { resolveSavedSources } from "./catalog";
import type { CharacterId } from "@/lib/simulation/network/characters";
import { conversationSources } from "./grounding";
import { generateGroundedDialogue } from "./provider";
import { createArchiveTools } from "./archive-tools";
import { hasNetworkAccess, readNetworkAccess } from "./access";
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

export async function activeConversationSources(
  savedIds: readonly string[] = [],
): Promise<ConversationSource[]> {
  const { bundle } = await getPublicContentView();
  return [
    ...conversationSources(bundle),
    ...(await resolveSavedSources(savedIds)),
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
  character: CharacterId;
  selectedIds: string[];
  context: RecentTurn[];
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
  const requestedIds = [
    ...turn.selectedIds,
    ...turn.context.flatMap((t) => t.sourceIds),
    ...(turn.inspectId ? [turn.inspectId] : []),
  ];
  const catalog = await activeConversationSources(requestedIds);
  const byId = new Map(catalog.map((source) => [source.id, source]));
  // SSR choices and returned cards must still exist in the current visible catalog.
  if (turn.inspectId && !byId.has(turn.inspectId))
    throw new ConversationError("source_unavailable", 409);
  if (turn.selectedIds.some((id) => !byId.has(id)))
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
  let dialogue: ConversationReply["dialogue"];
  let operations: string[] = [];
  let usedSources: ConversationSource[] = [];
  if (replay || turn.inspectId) {
    selected = session.state.lastSourceIds.length
      ? session.state.lastSourceIds
      : turn.inspectId
        ? [turn.inspectId]
        : [];
  } else if (!conversationInputAllowed(turn.message)) {
    status = "screened";
  } else {
    const candidates = [
      ...new Map(
        [
          ...turn.selectedIds.flatMap((id) => byId.get(id) ?? []),
          ...searchConversationSources(catalog, turn.message),
          ...turn.context
            .flatMap((t) => t.sourceIds)
            .flatMap((id) => byId.get(id) ?? []),
        ].map((source) => [source.id, source]),
      ).values(),
    ].slice(0, CONVERSATION_LIMITS.sourceCount);
    selected = candidates
      .slice(0, CONVERSATION_LIMITS.responseCards)
      .map((card) => card.id);
    if (!selected.length) status = "no_evidence";
    {
      const config = await readGeminiConfiguration();
      const key =
        config.enabled && config.tested && (await authorizeOwnerApi()).ok
          ? await decryptGeminiKey(config)
          : null;
      if (key) {
        let calls = session.calls;
        let budgetExhausted = false;
        const archive = createArchiveTools(
          candidates.slice(0, 4),
          activeConversationSources,
          async () => {
            if (
              (await readNetworkAccess()) &&
              !(await hasNetworkAccess(request.headers.get("cookie") ?? ""))
            )
              throw new ConversationError("password_required", 401);
            if ((await readGeminiConfiguration()).revision !== config.revision)
              return false;
            const allowed = await claimConversationCall(database, {
              ...session,
              calls,
            });
            if (!allowed) {
              budgetExhausted = true;
              return false;
            }
            calls++;
            const daily = await claimSimulationDailyBudget(
              database,
              CONVERSATION_LIMITS.dailyCalls,
            );
            if (!daily) budgetExhausted = true;
            return daily;
          },
        );
        const revalidateSources = archive.revalidate;
        archive.revalidate = async () =>
          (await readGeminiConfiguration()).revision === config.revision &&
          (!(await readNetworkAccess()) ||
            (await hasNetworkAccess(request.headers.get("cookie") ?? ""))) &&
          (await revalidateSources());
        {
          try {
            const result = await generateGroundedDialogue(
              key,
              turn.message,
              archive.sources(),
              turn.character,
              turn.context,
              AbortSignal.timeout(CONVERSATION_LIMITS.deadlineMilliseconds),
              archive,
            );
            if (result === null) status = "unavailable";
            else {
              dialogue = result;
              selected = [
                ...new Set(
                  result.sections.flatMap((section) => section.sourceIds),
                ),
              ].slice(0, 3);
              source = "gemini";
              status = "answered";
              if (!selected.length) status = "no_evidence";
            }
          } catch {
            status = budgetExhausted ? "budget" : "unavailable";
          }
          usedSources = archive.sources();
          operations = archive.operations;
        }
      }
    }
  }
  // Reproject after generation: revocation or hiding during a request wins.
  if (
    (await readNetworkAccess()) &&
    !(await hasNetworkAccess(request.headers.get("cookie") ?? ""))
  )
    throw new ConversationError("password_required", 401);
  for (const item of usedSources) byId.set(item.id, item);
  const fresh = await activeConversationSources([
    ...requestedIds,
    ...usedSources.map((item) => item.id),
  ]);
  const freshById = new Map(fresh.map((card) => [card.id, card]));
  if (
    dialogue &&
    [...selected, ...requestedIds].some(
      (id) =>
        JSON.stringify(byId.get(id)) !== JSON.stringify(freshById.get(id)),
    )
  ) {
    dialogue = undefined;
    source = "archive";
    status = "unavailable";
  }
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
    ...(dialogue ? { dialogue, operations } : {}),
  };
}
