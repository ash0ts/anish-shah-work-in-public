import {
  EditorialError,
  listEditorialRecords,
} from "@/lib/server/editorial";
import type { EditorialVisibility } from "@/lib/server/editorial-policy";
import { publicDatabaseError } from "@/lib/server/database-errors";
import { authorizeOwnerApi } from "@/lib/server/owner-auth";
import { ensureSanitizedPublicRecords } from "@/lib/server/public-record-seed";

export const dynamic = "force-dynamic";

const VISIBILITIES = new Set<EditorialVisibility>([
  "public",
  "review_required",
  "private",
  "excluded",
]);

function integerParameter(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export async function GET(request: Request) {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  const limit = integerParameter(url.searchParams.get("limit"), 50, 1, 100);
  const offset = integerParameter(url.searchParams.get("offset"), 0, 0, 10_000);
  const visibilityCandidate = url.searchParams.get("visibility");
  const visibility =
    visibilityCandidate &&
    VISIBILITIES.has(visibilityCandidate as EditorialVisibility)
      ? (visibilityCandidate as EditorialVisibility)
      : undefined;
  const recordType = url.searchParams.get("type")?.trim() || undefined;
  const query = url.searchParams.get("q")?.trim() || undefined;

  if (
    limit === null ||
    offset === null ||
    (visibilityCandidate && !visibility) ||
    (recordType && !/^[a-z0-9_-]{1,64}$/i.test(recordType)) ||
    (query && query.length > 100)
  ) {
    return Response.json(
      { error: "Invalid records query.", code: "invalid_query" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    await ensureSanitizedPublicRecords(authorization.user.email);
    const result = await listEditorialRecords({
      limit,
      offset,
      visibility,
      recordType,
      query,
    });
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
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
