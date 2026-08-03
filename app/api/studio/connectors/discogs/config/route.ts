import {
  discogsConfigGet,
  discogsConfigPut,
} from "@/lib/server/http/discogs-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return discogsConfigGet();
}

export async function PUT(request: Request) {
  return discogsConfigPut(request);
}
