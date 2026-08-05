import { publicTravelTripGet } from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  return publicTravelTripGet(request, context);
}
