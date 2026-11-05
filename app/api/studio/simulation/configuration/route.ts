import { handleConversationSetup } from "@/lib/server/simulation/conversation/setup-http";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleConversationSetup(request, "get");
export const PUT = (request: Request) => handleConversationSetup(request, "save");
