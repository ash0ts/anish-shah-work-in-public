import { publicDatabaseError } from "@/lib/server/database-errors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { confirmReleasePublication } from "@/lib/server/publication-checkpoint-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  if ((await request.text()).trim()) {
    return Response.json(
      { error: "The release checkpoint accepts no request fields." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    return Response.json(
      { checkpoint: await confirmReleasePublication() },
      {
        status: 201,
        headers: {
          "cache-control": "private, no-store",
          "x-robots-tag": "noindex, nofollow, noarchive",
        },
      },
    );
  } catch (error) {
    const safe = publicDatabaseError(error);
    return Response.json(
      { error: safe.message, code: safe.code },
      {
        status: 503,
        headers: {
          "cache-control": "private, no-store",
          "x-robots-tag": "noindex, nofollow, noarchive",
        },
      },
    );
  }
}
