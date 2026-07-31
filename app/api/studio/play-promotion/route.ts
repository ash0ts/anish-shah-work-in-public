import { authorizeOwnerApi } from "@/lib/server/owner-auth";
import { listPlayPromotions } from "@/lib/server/play-promotion";

export const dynamic = "force-dynamic";

export async function GET() {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  try {
    return Response.json(
      { status: "ready", promotions: await listPlayPromotions(authorization.user.email) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Promotion state is unavailable." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
