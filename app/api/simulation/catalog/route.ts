import { catalogQuery } from "@/lib/simulation/network/catalog-contract";
import { readSimulationCatalog } from "@/lib/server/simulation/conversation/catalog";
import {
  CONVERSATION_HEADERS,
  conversationFailure,
  conversationAccess,
} from "@/lib/server/simulation/conversation/http";
export async function GET(request: Request) {
  try {
    const owner = await conversationAccess(request);
    if (!owner.ok) return owner.response;
    const query = catalogQuery(new URL(request.url));
    if (!query)
      return Response.json(
        { code: "input_invalid" },
        { status: 400, headers: CONVERSATION_HEADERS },
      );
    return Response.json(
      await readSimulationCatalog(
        query.domain,
        query.q,
        query.page,
        "game_display",
        query.ids,
      ),
      { headers: CONVERSATION_HEADERS },
    );
  } catch (error) {
    return conversationFailure(error);
  }
}
