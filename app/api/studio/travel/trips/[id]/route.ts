import {
  studioTravelTripDelete,
  studioTravelTripGet,
  studioTravelTripPatch,
} from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return studioTravelTripGet(context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return studioTravelTripPatch(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return studioTravelTripDelete(request, context);
}
