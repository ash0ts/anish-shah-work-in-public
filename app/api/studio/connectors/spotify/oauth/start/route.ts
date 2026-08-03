import { spotifyOAuthStartPost } from "@/lib/server/http/spotify-oauth-start";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return spotifyOAuthStartPost(request);
}
