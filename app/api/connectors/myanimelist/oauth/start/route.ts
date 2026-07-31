import { startMyAnimeListOAuth } from "@/lib/server/connectors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "A JSON request body is required." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json(
      { error: "OAuth client credentials must be a JSON object." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  const candidate = body as Record<string, unknown>;
  const hasClientId = Object.hasOwn(candidate, "clientId");
  const hasClientSecret = Object.hasOwn(candidate, "clientSecret");
  if (
    hasClientId !== hasClientSecret ||
    (hasClientId &&
      (typeof candidate.clientId !== "string" ||
        typeof candidate.clientSecret !== "string"))
  ) {
    return Response.json(
      { error: "Both MyAnimeList client ID and client secret are required." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  const result = await startMyAnimeListOAuth({
    ...(hasClientId
      ? {
          clientId: candidate.clientId as string,
          clientSecret: candidate.clientSecret as string,
        }
      : {}),
    actorEmail: authorization.user.email,
    requestUrl: request.url,
  });
  const error =
    result.status === "invalid"
      ? "Use the client ID and client secret from a MyAnimeList API client."
      : result.status === "setup_required"
        ? result.reason === "database"
          ? "The site database is not ready."
          : result.reason === "encryption_key"
            ? "Connector encryption is not configured."
            : "SITE_URL must match this exact origin before OAuth can start."
        : undefined;

  return Response.json(error ? { ...result, error } : result, {
    status:
      result.status === "authorization_required"
        ? 200
        : result.status === "invalid"
          ? 400
          : 503,
    headers: { "cache-control": "private, no-store" },
  });
}
