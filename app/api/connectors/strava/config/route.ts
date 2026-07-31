import { publicDatabaseError } from "@/lib/server/database-errors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import {
  deleteStravaPublicConfig,
  saveStravaPublicConfig,
} from "@/lib/server/strava-config";

export const dynamic = "force-dynamic";

async function authorizeWrite(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return { response: crossOrigin } as const;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return { response: authorization.response } as const;

  return { user: authorization.user } as const;
}

export async function PUT(request: Request) {
  const authorization = await authorizeWrite(request);
  if ("response" in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "A JSON request body is required.", code: "invalid_json" },
      {
        status: 400,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }

  const embed =
    typeof body === "object" && body !== null && "embed" in body
      ? body.embed
      : undefined;

  try {
    const result = await saveStravaPublicConfig(
      embed,
      authorization.user.email,
    );
    if ("ok" in result && !result.ok) {
      return Response.json(
        { error: result.message, code: result.code },
        {
          status: 400,
          headers: { "cache-control": "private, no-store" },
        },
      );
    }

    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
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

export async function DELETE(request: Request) {
  const authorization = await authorizeWrite(request);
  if ("response" in authorization) return authorization.response;

  try {
    const result = await deleteStravaPublicConfig(
      authorization.user.email,
    );
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
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
