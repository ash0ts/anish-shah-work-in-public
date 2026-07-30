import {
  EditorialError,
  patchEditorialRecord,
} from "@/lib/server/editorial";
import { validateEditorialPatch } from "@/lib/server/editorial-policy";
import { publicDatabaseError } from "@/lib/server/database-errors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function expectedRevision(request: Request): string | null {
  const value = request.headers.get("if-match")?.trim();
  if (!value || value === "*" || value.startsWith("W/")) return null;
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

export async function PATCH(request: Request, context: RouteContext) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return Response.json(
      { error: "Content-Type must be application/json.", code: "invalid_media_type" },
      { status: 415, headers: { "cache-control": "private, no-store" } },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return Response.json(
      { error: "Editorial request is too large.", code: "request_too_large" },
      { status: 413, headers: { "cache-control": "private, no-store" } },
    );
  }

  const revision = expectedRevision(request);
  if (!revision) {
    return Response.json(
      {
        error: "A strong If-Match record revision is required.",
        code: "revision_required",
      },
      { status: 428, headers: { "cache-control": "private, no-store" } },
    );
  }

  const { id } = await context.params;
  if (!id || id.length > 240 || /[\u0000-\u001f]/.test(id)) {
    return Response.json(
      { error: "Invalid record id.", code: "invalid_record_id" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (body.length > 16_384) {
      return Response.json(
        { error: "Editorial request is too large.", code: "request_too_large" },
        { status: 413, headers: { "cache-control": "private, no-store" } },
      );
    }
    payload = JSON.parse(body);
  } catch {
    return Response.json(
      { error: "A valid JSON object is required.", code: "invalid_json" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  const validation = validateEditorialPatch(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.message, code: validation.code },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    const record = await patchEditorialRecord(
      id,
      validation.value,
      validation.changedFields,
      revision,
      authorization.user.email,
    );
    return Response.json(
      { record },
      {
        headers: {
          "cache-control": "private, no-store",
          etag: JSON.stringify(record.revision),
        },
      },
    );
  } catch (error) {
    if (error instanceof EditorialError) {
      return Response.json(
        { error: error.message, code: error.code },
        {
          status: error.status,
          headers: { "cache-control": "private, no-store" },
        },
      );
    }
    const safe = publicDatabaseError(error);
    return Response.json(
      { error: safe.message, code: safe.code },
      {
        status: 503,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
}
