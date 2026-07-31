import {
  getPublicConnectorSnapshot,
  isConnectorProvider,
  refreshConnector,
} from "@/lib/server/connectors";
import {
  connectorSnapshotNeedsUpgrade,
  projectConnectorSnapshotForPublic,
} from "@/lib/server/connectors/public-gallery";
import { getRequestExecutionContext } from "vinext/shims/request-context";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { provider: candidate } = await context.params;
  if (!isConnectorProvider(candidate)) {
    return Response.json(
      { error: "Unknown connector." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const snapshot = await getPublicConnectorSnapshot(candidate);
  const needsSchemaUpgrade =
    snapshot.status === "ready" &&
    connectorSnapshotNeedsUpgrade(snapshot.payload);
  const needsStaleRefresh =
    (snapshot.status === "ready" && snapshot.stale) ||
    (snapshot.status === "unavailable" &&
      snapshot.reason === "stale_expired");
  if (needsSchemaUpgrade || needsStaleRefresh) {
    const refresh = refreshConnector(
      candidate,
      needsSchemaUpgrade ? "schema_upgrade" : "stale_revalidate",
      null,
    ).catch(() => undefined);
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

  const searchParams = new URL(request.url).searchParams;
  return Response.json(
    {
      ...snapshot,
      payload: projectConnectorSnapshotForPublic(
        candidate,
        snapshot.payload,
        searchParams,
      ),
    },
    {
      headers: { "cache-control": "no-store" },
    },
  );
}
