import { authorizeOwnerApi, rejectCrossOriginWrite } from "@/lib/server/owner-auth";
import { applyPlayPromotion } from "@/lib/server/play-promotion";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  if (authorization.user.authSource === "local-development") {
    return Response.json(
      { error: "Apply staged providers from the production Studio." },
      { status: 403, headers: { "cache-control": "private, no-store" } },
    );
  }
  const { id } = await context.params;
  try {
    const result = await applyPlayPromotion({ id, ownerEmail: authorization.user.email });
    const status = result.status === "complete" ? 200 : result.status === "not_found" ? 404 : 409;
    return Response.json(result, {
      status,
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "The staged provider settings could not be applied." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
