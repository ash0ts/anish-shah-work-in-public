import { discogsOAuthStartPost } from "@/lib/server/http/discogs-oauth-start";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return discogsOAuthStartPost(request);
}
