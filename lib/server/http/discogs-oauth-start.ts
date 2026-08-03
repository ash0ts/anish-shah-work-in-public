import {
  createDiscogsOAuthBrowserNonce,
  discogsOAuthBrowserCookie,
} from "@/lib/server/connectors/discogs-oauth";
import { startDiscogsOAuth } from "@/lib/server/connectors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { readBoundedJsonBody } from "@/lib/server/request-security";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export async function discogsOAuthStartPost(
  request: Request,
): Promise<Response> {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  const parsed = await readBoundedJsonBody(request, { maxBytes: 16_384 });
  if (!parsed.ok) return parsed.response;
  if (
    typeof parsed.value !== "object" ||
    parsed.value === null ||
    Array.isArray(parsed.value)
  ) {
    return Response.json(
      { error: "Discogs consumer credentials must be a JSON object." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const candidate = parsed.value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  const reusingStoredClient = keys.length === 0;
  const exactNewClient =
    keys.length === 2 &&
    keys.includes("consumerKey") &&
    keys.includes("consumerSecret") &&
    typeof candidate.consumerKey === "string" &&
    typeof candidate.consumerSecret === "string";
  if (!reusingStoredClient && !exactNewClient) {
    return Response.json(
      { error: "Both Discogs consumer key and consumer secret are required." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const browserNonce = createDiscogsOAuthBrowserNonce();
  const result = await startDiscogsOAuth({
    ...(exactNewClient
      ? {
          consumerKey: candidate.consumerKey as string,
          consumerSecret: candidate.consumerSecret as string,
        }
      : {}),
    actorEmail: authorization.user.email,
    browserNonce,
    requestUrl: request.url,
  });
  const error =
    result.status === "invalid"
      ? "Use the consumer key and consumer secret from a Discogs application."
      : result.status === "setup_required"
        ? result.reason === "database"
          ? "The site database is not ready."
          : result.reason === "encryption_key"
            ? "Connector encryption is not configured."
            : "SITE_URL must match this exact origin before OAuth can start."
        : result.status === "rate_limited"
          ? "Discogs rate-limited the authorization request. Wait before trying again."
          : result.status === "provider_unavailable"
            ? result.reason === "timeout"
              ? "Discogs did not answer the authorization request in time."
              : result.reason === "redirect"
                ? "Discogs returned an unexpected authorization redirect."
                : result.reason === "upstream"
                  ? "Discogs returned a temporary authorization service error."
                  : "The Worker could not reach Discogs' authorization service."
            : result.status === "token_exchange_failed"
              ? "Discogs did not issue a usable request token."
              : undefined;
  const headers = new Headers(PRIVATE_HEADERS);
  if (result.status === "authorization_required") {
    headers.set(
      "set-cookie",
      discogsOAuthBrowserCookie(browserNonce, request.url),
    );
  }
  return Response.json(error ? { ...result, error } : result, {
    status:
      result.status === "authorization_required"
        ? 200
        : result.status === "invalid"
          ? 400
          : result.status === "rate_limited"
            ? 429
            : 503,
    headers,
  });
}
