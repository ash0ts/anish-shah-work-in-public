import { publicTravelAtlasGet } from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return publicTravelAtlasGet();
}
