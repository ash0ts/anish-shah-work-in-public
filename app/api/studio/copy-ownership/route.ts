import { getCopyOwnershipReport } from "@/lib/server/copy-ownership";
import { publicDatabaseError } from "@/lib/server/database-errors";
import { EditorialError } from "@/lib/server/editorial";
import { authorizeOwnerApi } from "@/lib/server/owner-auth";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

export async function GET() {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  try {
    return Response.json(await getCopyOwnershipReport(), {
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    if (error instanceof EditorialError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: PRIVATE_HEADERS },
      );
    }
    const safe = publicDatabaseError(error);
    return Response.json(
      { error: safe.message, code: safe.code },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
