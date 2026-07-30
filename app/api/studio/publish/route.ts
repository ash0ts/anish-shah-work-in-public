import {
  createPublicationSnapshot,
  EditorialError,
} from "@/lib/server/editorial";
import { publicDatabaseError } from "@/lib/server/database-errors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { ensureSanitizedPublicRecords } from "@/lib/server/public-record-seed";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  const body = await request.text();
  if (body.trim()) {
    return Response.json(
      {
        error: "Publication does not accept request fields.",
        code: "unexpected_publish_fields",
      },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    await ensureSanitizedPublicRecords(authorization.user.email);
    const publication = await createPublicationSnapshot(
      authorization.user.email,
    );
    return Response.json(
      { publication },
      {
        status: 201,
        headers: {
          "cache-control": "private, no-store",
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
