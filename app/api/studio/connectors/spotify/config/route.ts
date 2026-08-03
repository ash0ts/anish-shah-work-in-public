import {
  spotifyConfigGet,
  spotifyConfigPut,
} from "@/lib/server/http/spotify-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return spotifyConfigGet();
}

export async function PUT(request: Request) {
  return spotifyConfigPut(request);
}
