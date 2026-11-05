import { readBoundedJsonBody } from "@/lib/server/request-security";
import { runtimeValue } from "@/lib/server/runtime-env";
import {
  accessCookie,
  unlockNetwork,
} from "@/lib/server/simulation/conversation/access";
import {
  CONVERSATION_HEADERS,
  conversationFailure,
} from "@/lib/server/simulation/conversation/http";
import { ConversationError } from "@/lib/server/simulation/conversation/settings";
import { z } from "zod";
export const dynamic = "force-dynamic";
async function readForm(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ConversationError("input_invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2048) {
      await reader.cancel();
      throw new ConversationError("input_invalid", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const params = new URLSearchParams(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if ([...params.keys()].length !== 1 || !params.has("password"))
    throw new ConversationError("input_invalid");
  return { ok: true as const, value: { password: params.get("password") } };
}
export async function POST(request: Request) {
  const form =
    request.headers.get("content-type")?.split(";")[0] ===
    "application/x-www-form-urlencoded";
  try {
    if (
      runtimeValue("SIMULATION_EXPERIENCE_MODE") !== "conversation-v2" ||
      runtimeValue("DEPLOYMENT_TIER") === "preview"
    )
      throw new ConversationError("not_found", 404);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new ConversationError("same_origin_required", 403);
    const body = form
      ? await readForm(request)
      : await readBoundedJsonBody(request, { maxBytes: 1024 });
    if (!body.ok) return body.response;
    const parsed = z
      .union([
        z.object({ password: z.string().max(128) }).strict(),
        z.object({ lock: z.literal(true) }).strict(),
      ])
      .safeParse(body.value);
    if (!parsed.success) throw new ConversationError("input_invalid");
    const cookie =
      "lock" in parsed.data
        ? accessCookie("", 0)
        : await unlockNetwork(parsed.data.password);
    if (form)
      return new Response(null, {
        status: 303,
        headers: {
          ...CONVERSATION_HEADERS,
          "set-cookie": cookie,
          location: "/simulation",
        },
      });
    return Response.json(
      { status: "lock" in parsed.data ? "locked" : "unlocked" },
      { headers: { ...CONVERSATION_HEADERS, "set-cookie": cookie } },
    );
  } catch (error) {
    if (
      form &&
      error instanceof ConversationError &&
      [401, 429].includes(error.status)
    )
      return new Response(null, {
        status: 303,
        headers: {
          ...CONVERSATION_HEADERS,
          location: "/simulation?access=denied",
        },
      });
    return conversationFailure(error);
  }
}
