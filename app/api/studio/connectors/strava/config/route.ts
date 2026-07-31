import {
  stravaConfigDelete,
  stravaConfigGet,
  stravaConfigPut,
} from "@/lib/server/http/strava-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return stravaConfigGet();
}

export async function PUT(request: Request) {
  return stravaConfigPut(request);
}

export async function DELETE(request: Request) {
  return stravaConfigDelete(request);
}
