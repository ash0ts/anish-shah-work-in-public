import { authorizeOwnerApi } from "@/lib/server/owner-auth";
import { getStudioOverview } from "@/lib/server/connectors";

export const dynamic = "force-dynamic";

export async function GET() {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  const overview = await getStudioOverview(authorization.user.email);
  return Response.json(overview, {
    headers: { "cache-control": "private, no-store" },
  });
}
