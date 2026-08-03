import { getStudioHealth } from "@/lib/server/maintenance";
import { authorizeOwnerApi } from "@/lib/server/owner-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  return Response.json(await getStudioHealth(), {
    headers: {
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
