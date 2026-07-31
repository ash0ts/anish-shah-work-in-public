import { stagePlayPromotion } from "@/lib/server/play-promotion";
import { readBoundedJsonBody } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (request.headers.get("origin") || request.headers.get("cookie")) {
    return Response.json(
      { error: "Browser-originated promotion requests are not accepted." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const body = await readBoundedJsonBody(request, { maxBytes: 64 * 1024 });
  if (!body.ok) return body.response;
  const transferCode =
    typeof body.value === "object" && body.value !== null &&
    "transferCode" in body.value
      ? body.value.transferCode
      : undefined;
  const payload =
    typeof body.value === "object" && body.value !== null && "payload" in body.value
      ? body.value.payload
      : undefined;
  try {
    const result = await stagePlayPromotion({ transferCode, payload, requestUrl: request.url });
    const status =
      result.status === "staged" ? 200 :
      result.status === "setup_required" ? 503 :
      result.status === "already_used" ? 409 : 400;
    return Response.json(result, {
      status,
      headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
    });
  } catch {
    return Response.json(
      { error: "The transfer could not be staged." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
