import { handleConversation } from "@/lib/server/simulation/conversation/http";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleConversation(request, "get");
export const POST = (request: Request) => handleConversation(request, "start");
export const DELETE = (request: Request) => handleConversation(request, "end");
