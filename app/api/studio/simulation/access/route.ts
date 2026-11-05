import { z } from "zod";
import {
  conversationOwner,
  conversationFailure,
  CONVERSATION_HEADERS,
  requestRevision,
} from "@/lib/server/simulation/conversation/http";
import { readBoundedJsonBody } from "@/lib/server/request-security";
import {
  saveNetworkAccess,
  passwordInput,
} from "@/lib/server/simulation/conversation/access";
import { ConversationError } from "@/lib/server/simulation/conversation/settings";
export const dynamic = "force-dynamic";
export async function PUT(request: Request) {
  try {
    const owner = await conversationOwner(request, true);
    if (!owner.ok) return owner.response;
    const body = await readBoundedJsonBody(request, { maxBytes: 1024 });
    if (!body.ok) return body.response;
    const parsed = z
      .union([
        z.object({ password: passwordInput }).strict(),
        z.object({ enabled: z.boolean() }).strict(),
      ])
      .safeParse(body.value);
    if (!parsed.success) throw new ConversationError("input_invalid");
    return Response.json(
      {
        access: await saveNetworkAccess(
          parsed.data,
          requestRevision(request),
          owner.user.email,
        ),
      },
      { headers: CONVERSATION_HEADERS },
    );
  } catch (error) {
    return conversationFailure(error);
  }
}
