import { studioTravelPublicationPost } from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  return studioTravelPublicationPost(request, context, true);
}
