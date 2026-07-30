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

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

async function authorizedProvider(
  request: Request,
  context: RouteContext,
) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return { response: crossOrigin } as const;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return { response: authorization.response } as const;

  const { provider: candidate } = await context.params;
  if (!isConnectorProvider(candidate)) {
    return {
      response: Response.json({ error: "Unknown connector." }, { status: 404 }),
    } as const;
  }

  return {
    provider: candidate,
    user: authorization.user,
  } as const;
}

export async function POST(request: Request, context: RouteContext) {
  const authorized = await authorizedProvider(request, context);
  if ("response" in authorized) return authorized.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "A JSON request body is required." },
      { status: 400 },
    );
  }

  let credentialInput:
    | string
    | { apiKey: string; steamId: string };
  if (authorized.provider === "steam") {
    const apiKey =
      typeof payload === "object" &&
      payload !== null &&
      "apiKey" in payload &&
      typeof payload.apiKey === "string"
        ? payload.apiKey.trim()
        : "";
    const steamId =
      typeof payload === "object" &&
      payload !== null &&
      "steamId" in payload &&
      typeof payload.steamId === "string"
        ? payload.steamId.trim()
        : "";
    if (
      !apiKey ||
      apiKey.length > 128 ||
      !steamId ||
      steamId.length > 32
    ) {
      return Response.json(
        { error: "A Steam Web API key and SteamID64 are required." },
        { status: 400 },
      );
    }
    credentialInput = { apiKey, steamId };
  } else {
    const secret =
      typeof payload === "object" &&
      payload !== null &&
      "secret" in payload &&
      typeof payload.secret === "string"
        ? payload.secret.trim()
        : "";
    if (secret.length < 8 || secret.length > 8192) {
      return Response.json(
        { error: "Credential must be between 8 and 8192 characters." },
        { status: 400 },
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

export async function DELETE(request: Request, context: RouteContext) {
  const authorized = await authorizedProvider(request, context);
  if ("response" in authorized) return authorized.response;

  try {
    await deleteConnectorCredential(
      authorized.provider,
      authorized.user.email,
    );
    return Response.json(
      {
        status: "disconnected",
        provider: authorized.provider,
        snapshotsDeleted: authorized.provider === "steam",
        syncHistoryDeleted: authorized.provider === "steam",
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
