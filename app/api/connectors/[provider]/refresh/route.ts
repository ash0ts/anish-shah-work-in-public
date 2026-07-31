import {
  isConnectorProvider,
  refreshConnector,
} from "@/lib/server/connectors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  const { provider: candidate } = await context.params;
  if (!isConnectorProvider(candidate)) {
    return Response.json({ error: "Unknown connector." }, { status: 404 });
  }

  const result = await refreshConnector(
    candidate,
    "manual",
    authorization.user.email,
  );
  const status =
    result.status === "complete"
      ? 200
      : result.status === "withheld"
        ? 200
        : result.status === "already_running" || result.status === "not_due"
          ? 202
          : result.status === "setup_required"
            ? 503
            : 424;

  const error =
    result.status === "setup_required"
      ? result.reason === "credential"
        ? "Connect this provider before refreshing it."
        : result.reason === "encryption_key"
          ? "Connector encryption is not configured."
          : result.reason === "storage_disclosure"
            ? "Configure the truthful Steam data storage-country disclosure before syncing."
            : "The site database is not ready."
      : result.status === "failed"
          ? result.code === "credential_expired" ||
            result.code === "reauthorization_required"
            ? "The provider credential needs to be renewed."
            : result.code === "rate_limited"
              ? "The provider is rate-limiting requests. The previous snapshot is still live."
              : "The provider could not be refreshed. The previous snapshot is still live."
          : undefined;
  const message =
    result.status === "withheld"
      ? "Steam game details are not public, so every stored Steam snapshot was unpublished."
      : undefined;

  return Response.json(
    error ? { ...result, error } : message ? { ...result, message } : result,
    {
    status,
    headers: { "cache-control": "private, no-store" },
    },
  );
}
