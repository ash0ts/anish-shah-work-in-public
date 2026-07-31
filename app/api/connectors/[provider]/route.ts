import {
  getPublicConnectorSnapshot,
  isConnectorProvider,
  refreshConnector,
} from "@/lib/server/connectors";
import { getRequestExecutionContext } from "vinext/shims/request-context";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { provider: candidate } = await context.params;
  if (!isConnectorProvider(candidate)) {
    return Response.json(
      { error: "Unknown connector." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const snapshot = await getPublicConnectorSnapshot(candidate);
  if (
    (snapshot.status === "ready" && snapshot.stale) ||
    (snapshot.status === "unavailable" &&
      snapshot.reason === "stale_expired")
  ) {
    const refresh = refreshConnector(candidate, "stale_revalidate", null).catch(
      () => undefined,
    );
    const executionContext = getRequestExecutionContext();
    if (executionContext) executionContext.waitUntil(refresh);
    else void refresh;
  }

  if (snapshot.status === "unavailable") {
    return Response.json(
      {
        provider: candidate,
        status: "unavailable",
        message: "This personal stream has not been published yet.",
      },
      {
        status: 404,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  return Response.json(snapshot, {
    headers: { "cache-control": "no-store" },
  });
}
