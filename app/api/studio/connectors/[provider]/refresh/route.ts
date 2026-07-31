import { connectorRefreshPost } from "@/lib/server/http/connector-refresh";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  return connectorRefreshPost(request, context);
}
