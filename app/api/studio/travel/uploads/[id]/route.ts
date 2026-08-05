import { studioTravelUploadPut } from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  return studioTravelUploadPut(request, context);
}
