import { handleConversationSetup } from "@/lib/server/simulation/conversation/setup-http";
export const dynamic = "force-dynamic";
export const PUT = (request: Request) => handleConversationSetup(request, "permission");
