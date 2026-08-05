import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { runtimeDatabase, runtimeValue } from "@/lib/server/runtime-env";
import { bootstrapStagingRetention } from "@/lib/server/staging-maintenance";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  if ((await request.text()).trim()) {
    return Response.json(
      {
        error: "The staging maintenance bootstrap accepts no request fields.",
        code: "unexpected_maintenance_fields",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const result = await bootstrapStagingRetention(
      runtimeDatabase(),
      runtimeValue("DEPLOYMENT_TIER"),
    );
    if (!result.ok) {
      return Response.json(
        {
          error:
            result.code === "not_staging"
              ? "This maintenance bootstrap is available only in staging."
              : "The staging database binding is unavailable.",
          code: result.code,
        },
        {
          status: result.code === "not_staging" ? 404 : 503,
          headers: PRIVATE_HEADERS,
        },
      );
    }
    return Response.json(
      { status: "complete", checkedAt: result.checkedAt },
      { status: 201, headers: PRIVATE_HEADERS },
    );
  } catch {
    return Response.json(
      {
        error: "Staging retention maintenance did not complete.",
        code: "maintenance_failed",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
