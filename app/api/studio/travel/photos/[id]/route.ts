import {
  studioTravelPhotoDelete,
  studioTravelPhotoPatch,
} from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return studioTravelPhotoPatch(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return studioTravelPhotoDelete(request, context);
}
