import { publicDatabaseError } from "@/lib/server/database-errors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { readBoundedJsonBody } from "@/lib/server/request-security";
import {
  deleteStravaPublicConfig,
  getStravaPortableConfig,
  getStravaPublicConfig,
  saveStravaPublicConfig,
  verifyStoredStravaPublicConfig,
} from "@/lib/server/strava-config";

export async function stravaConfigGet(): Promise<Response> {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  try {
    const [portable, published] = await Promise.all([
      getStravaPortableConfig(),
      getStravaPublicConfig(),
    ]);
    if (!portable || published.status !== "ready") {
      return Response.json(
        { status: "unavailable", provider: "strava" },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    return Response.json(
      {
        status: "ready",
        provider: "strava",
        payload: {
          ...portable,
          embedStatus: published.config.embedStatus,
          checkedAt: published.config.embed?.checkedAt ?? null,
          updatedAt: published.config.updatedAt,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const safe = publicDatabaseError(error);
    return Response.json(
      { error: safe.message, code: safe.code },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}

async function authorizeWrite(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return { ok: false, response: crossOrigin } as const;
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) {
    return { ok: false, response: authorization.response } as const;
  }
  return { ok: true, user: authorization.user } as const;
}

export async function stravaConfigPut(request: Request): Promise<Response> {
  const authorization = await authorizeWrite(request);
  if (!authorization.ok) return authorization.response;

  const parsed = await readBoundedJsonBody(request, { maxBytes: 16_384 });
  if (!parsed.ok) return parsed.response;
  try {
    const result = await saveStravaPublicConfig(
      parsed.value,
      authorization.user.email,
    );
    if ("ok" in result && !result.ok) {
      return Response.json(
        { error: result.message, code: result.code },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const safe = publicDatabaseError(error);
    return Response.json(
      { error: safe.message, code: safe.code },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}

export async function stravaConfigDelete(request: Request): Promise<Response> {
  const authorization = await authorizeWrite(request);
  if (!authorization.ok) return authorization.response;
  try {
    const result = await deleteStravaPublicConfig(authorization.user.email);
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const safe = publicDatabaseError(error);
    return Response.json(
      { error: safe.message, code: safe.code },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}

export async function stravaVerifyPost(request: Request): Promise<Response> {
  const authorization = await authorizeWrite(request);
  if (!authorization.ok) return authorization.response;
  try {
    const result = await verifyStoredStravaPublicConfig(
      authorization.user.email,
    );
    const error =
      result.status === "not_configured"
        ? result.reason === "embed"
          ? "Save an official Strava embed before verifying it."
          : "Save the Strava profile before verifying it."
        : result.status === "conflict"
          ? "The Strava configuration changed during verification. Try again."
          : result.status === "setup_required"
            ? "The site database is not ready."
            : undefined;
    return Response.json(error ? { ...result, error } : result, {
      status:
        result.status === "verified"
          ? 200
          : result.status === "not_configured"
            ? 400
            : result.status === "conflict"
              ? 409
              : 503,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const safe = publicDatabaseError(error);
    return Response.json(
      { error: safe.message, code: safe.code },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
