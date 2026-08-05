import {
  studioTravelPlaceDelete,
  studioTravelPlacePatch,
} from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return studioTravelPlacePatch(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return studioTravelPlaceDelete(request, context);
}
