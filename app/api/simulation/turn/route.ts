import { handleConversation } from "@/lib/server/simulation/conversation/http";

export const dynamic = "force-dynamic";

export const POST = (request: Request) => handleConversation(request, "turn");
