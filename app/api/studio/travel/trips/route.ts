import {
  studioTravelTripsGet,
  studioTravelTripsPost,
} from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return studioTravelTripsGet();
}

export async function POST(request: Request) {
  return studioTravelTripsPost(request);
}
