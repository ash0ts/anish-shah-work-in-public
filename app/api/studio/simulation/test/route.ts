import { handleConversationSetup } from "@/lib/server/simulation/conversation/setup-http";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleConversationSetup(request, "test");
