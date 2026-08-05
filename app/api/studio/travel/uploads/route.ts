import { studioTravelUploadPost } from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return studioTravelUploadPost(request);
}
