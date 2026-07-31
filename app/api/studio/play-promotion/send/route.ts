import { readBoundedJsonBody } from "@/lib/server/request-security";
import { authorizeOwnerApi, rejectCrossOriginWrite } from "@/lib/server/owner-auth";
import { sendLocalPlayPromotion } from "@/lib/server/play-promotion";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  if (authorization.user.authSource !== "local-development") {
    return Response.json(
      { error: "This endpoint is available only in the loopback local Studio." },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  }
  const body = await readBoundedJsonBody(request, { maxBytes: 8 * 1024 });
  if (!body.ok) return body.response;
  const transferCode =
    typeof body.value === "object" && body.value !== null &&
    "transferCode" in body.value
      ? body.value.transferCode
      : undefined;
  try {
    const result = await sendLocalPlayPromotion({ transferCode, requestUrl: request.url });
    return Response.json(result, {
      status: result.status === "staged" ? 200 : result.status === "remote_error" ? 502 : 400,
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "Local credentials could not be staged." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
