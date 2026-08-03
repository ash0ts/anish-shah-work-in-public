import {
  deleteConnectorCredential,
  isConnectorProvider,
  saveConnectorCredential,
} from "@/lib/server/connectors";
import { publicDatabaseError } from "@/lib/server/database-errors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { readBoundedJsonBody } from "@/lib/server/request-security";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

async function authorizedProvider(request: Request, context: RouteContext) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return { ok: false, response: crossOrigin } as const;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) {
    return { ok: false, response: authorization.response } as const;
  }

  const { provider: candidate } = await context.params;
  if (!isConnectorProvider(candidate)) {
    return {
      ok: false,
      response: Response.json({ error: "Unknown connector." }, { status: 404 }),
    } as const;
  }
  return {
    ok: true,
    provider: candidate,
    user: authorization.user,
  } as const;
}

export async function credentialPost(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const authorized = await authorizedProvider(request, context);
  if (!authorized.ok) return authorized.response;

  const body = await readBoundedJsonBody(request, { maxBytes: 12_288 });
  if (!body.ok) return body.response;
  const payload = body.value;

  if (
    authorized.provider === "myanimelist" ||
    authorized.provider === "spotify"
  ) {
    return Response.json(
      {
        error:
          `Connect ${authorized.provider === "spotify" ? "Spotify" : "MyAnimeList"} through its OAuth setup instead of pasting an access token.`,
        code: "oauth_required",
      },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  let credentialInput: string | { apiKey: string; steamId: string };
  if (authorized.provider === "steam") {
    const apiKey =
      typeof payload === "object" &&
      payload !== null &&
      "apiKey" in payload &&
      typeof payload.apiKey === "string"
        ? payload.apiKey.trim()
        : "";
    const steamId64 =
      typeof payload === "object" &&
      payload !== null &&
      "steamId64" in payload &&
      typeof payload.steamId64 === "string"
        ? payload.steamId64.trim()
        : typeof payload === "object" &&
            payload !== null &&
            "steamId" in payload &&
            typeof payload.steamId === "string"
          ? payload.steamId.trim()
          : "";
    if (!apiKey || apiKey.length > 128 || !steamId64 || steamId64.length > 32) {
      return Response.json(
        { error: "A Steam Web API key and SteamID64 are required." },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }
    credentialInput = { apiKey, steamId: steamId64 };
  } else {
    const secret =
      typeof payload === "object" &&
      payload !== null &&
      "secret" in payload &&
      typeof payload.secret === "string"
        ? payload.secret.trim()
        : "";
    if (secret.length < 8 || secret.length > 8_192) {
      return Response.json(
        { error: "Credential must be between 8 and 8192 characters." },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }
    credentialInput = secret;
  }

  try {
    const result = await saveConnectorCredential(
      authorized.provider,
      credentialInput,
      authorized.user.email,
    );
    const responseBody =
      result.status === "saved"
        ? result
        : {
            ...result,
            error:
              result.reason === "credential"
                ? authorized.provider === "steam"
                  ? "Use a valid 32-character Steam Web API key and 17-digit SteamID64."
                  : "The provider credential is empty or invalid."
                : result.reason === "encryption_key"
                  ? "Connector encryption is not configured correctly."
                  : result.reason === "storage_disclosure"
                    ? "Configure the truthful Steam data storage-country disclosure before connecting."
                    : "The site database is not ready.",
          };
    return Response.json(responseBody, {
      status:
        result.status === "saved"
          ? 200
          : result.status === "invalid"
            ? 400
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

export async function credentialDelete(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const authorized = await authorizedProvider(request, context);
  if (!authorized.ok) return authorized.response;

  try {
    await deleteConnectorCredential(authorized.provider, authorized.user.email);
    return Response.json(
      {
        status: "disconnected",
        provider: authorized.provider,
        snapshotsDeleted: true,
        syncHistoryDeleted: true,
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
