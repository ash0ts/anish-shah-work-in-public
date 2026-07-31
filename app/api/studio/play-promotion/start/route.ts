import { authorizeOwnerApi, rejectCrossOriginWrite } from "@/lib/server/owner-auth";
import { issuePlayPromotion } from "@/lib/server/play-promotion";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  if (authorization.user.authSource === "local-development") {
    return Response.json(
      { error: "Generate the transfer code in the production Studio." },
      { status: 403, headers: { "cache-control": "private, no-store" } },
    );
  }
  try {
    const result = await issuePlayPromotion({
      ownerEmail: authorization.user.email,
      requestUrl: request.url,
    });
    return Response.json(result, {
      status: result.status === "issued" ? 200 : 503,
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "A transfer code could not be created." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
