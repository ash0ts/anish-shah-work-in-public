import { stravaVerifyPost } from "@/lib/server/http/strava-config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return stravaVerifyPost(request);
}
