import { z } from "zod";
import { authorizeOwnerApi, rejectCrossOriginWrite } from "../../owner-auth";
import { readBoundedJsonBody } from "../../request-security";
import { runtimeValue } from "../../runtime-env";
import {
  expiredSimulationSessionCookie,
  simulationSessionCookie,
} from "../session-crypto";
import { CONVERSATION_VERSION } from "@/lib/simulation/conversation-contract";
import { ConversationError } from "./settings";
import {
  currentConversation,
  endConversation,
  startConversation,
  submitConversation,
} from "./service";

export const CONVERSATION_HEADERS = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
};
export function conversationFailure(error: unknown) {
  const known = error instanceof ConversationError;
  return Response.json(
    { code: known ? error.code : "unavailable" },
    { status: known ? error.status : 503, headers: CONVERSATION_HEADERS },
  );
}
export function requestRevision(request: Request) {
  const raw = request.headers.get("if-match") ?? "";
  if (!/^(0|[1-9][0-9]{0,8})$/.test(raw))
    throw new ConversationError("revision_required", 428);
  return Number(raw);
}
export async function conversationOwner(request: Request, write = false) {
  // Hosted public activation is deliberately unavailable in this release.
  const tier = runtimeValue("DEPLOYMENT_TIER");
  if (
    tier === "preview" ||
    tier === "production" ||
    runtimeValue("SIMULATION_EXPERIENCE_MODE") !== "conversation-v2"
  )
    throw new ConversationError("not_found", 404);
  if (
    write &&
    (request.headers.get("origin") !== new URL(request.url).origin ||
      rejectCrossOriginWrite(request))
  )
    throw new ConversationError("same_origin_required", 403);
  const result = await authorizeOwnerApi();
  if (!result.ok) {
    for (const [name, value] of Object.entries(CONVERSATION_HEADERS)) result.response.headers.set(name, value);
  }
  return result;
}
const sessionInput = z
  .object({ version: z.literal(CONVERSATION_VERSION) })
  .strict();
const turnInput = z
  .object({
    version: z.literal(CONVERSATION_VERSION),
    requestId: z.string().uuid(),
    message: z.string().max(800),
    inspectId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9:._-]{0,127}$/)
      .nullable(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.message.trim()) !== Boolean(value.inspectId),
  );
export async function handleConversation(
  request: Request,
  action: "get" | "start" | "end" | "turn",
) {
  try {
    const owner = await conversationOwner(request, action !== "get");
    if (!owner.ok) return owner.response;
    if (action === "get")
      return Response.json(await currentConversation(request), {
        headers: CONVERSATION_HEADERS,
      });
    if (action === "end") {
      await endConversation(request);
      return Response.json(
        { status: "deleted" },
        {
          headers: {
            ...CONVERSATION_HEADERS,
            "set-cookie": expiredSimulationSessionCookie(),
          },
        },
      );
    }
    const revision = action === "turn" ? requestRevision(request) : 0;
    const body = await readBoundedJsonBody(request, {
      maxBytes: action === "start" ? 256 : 4_096,
    });
    if (!body.ok) return body.response;
    if (action === "start") {
      if (!sessionInput.safeParse(body.value).success)
        throw new ConversationError("input_invalid");
      const created = await startConversation(request);
      return Response.json(
        { version: CONVERSATION_VERSION, revision: created.revision },
        {
          status: 201,
          headers: {
            ...CONVERSATION_HEADERS,
            "set-cookie": simulationSessionCookie(created.token),
          },
        },
      );
    }
    const parsed = turnInput.safeParse(body.value);
    if (!parsed.success) throw new ConversationError("input_invalid");
    return Response.json(
      await submitConversation(request, parsed.data, revision),
      { headers: CONVERSATION_HEADERS },
    );
  } catch (error) {
    return conversationFailure(error);
  }
}
