import { myAnimeListOAuthStartPost } from "@/lib/server/http/myanimelist-oauth-start";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return myAnimeListOAuthStartPost(request);
}
