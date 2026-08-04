import { studioTravelPhotoPreviewGet } from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return studioTravelPhotoPreviewGet(context);
}
