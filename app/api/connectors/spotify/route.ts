import {
  getPublicConnectorSnapshot,
  getSpotifyPublicFallback,
  refreshConnector,
} from "@/lib/server/connectors";
import {
  connectorSnapshotNeedsUpgrade,
  projectConnectorSnapshotForPublic,
} from "@/lib/server/connectors/public-gallery";
import { getRequestExecutionContext } from "vinext/shims/request-context";
import { previewConnectorSnapshot } from "@/lib/server/preview-connector-fixtures";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const preview = previewConnectorSnapshot("spotify", searchParams);
  if (preview) {
    return Response.json(
      preview.status === "ready"
        ? {
            ...preview,
            payload: projectConnectorSnapshotForPublic(
              "spotify",
              preview.payload,
              searchParams,
            ),
          }
        : preview,
      { headers: { "cache-control": "private, no-store" } },
    );
  }
  const snapshot = await getPublicConnectorSnapshot("spotify");
  const needsSchemaUpgrade =
    snapshot.status === "ready" &&
    connectorSnapshotNeedsUpgrade(snapshot.payload);
  const needsRefresh =
    needsSchemaUpgrade ||
    (snapshot.status === "ready" && snapshot.stale) ||
    (snapshot.status === "unavailable" &&
      snapshot.reason === "stale_expired");
  if (needsRefresh) {
    const refresh = refreshConnector(
      "spotify",
      needsSchemaUpgrade ? "schema_upgrade" : "stale_revalidate",
      null,
    ).catch(() => undefined);
    const executionContext = getRequestExecutionContext();
    if (executionContext) executionContext.waitUntil(refresh);
    else void refresh;
  }

  if (snapshot.status === "ready") {
    return Response.json(
      {
        ...snapshot,
        payload: projectConnectorSnapshotForPublic(
          "spotify",
          snapshot.payload,
          searchParams,
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const fallback = await getSpotifyPublicFallback();
  if (fallback.profileUrl || fallback.fallbackEmbed) {
    return Response.json(
      {
        status: "fallback",
        provider: "spotify",
        ...fallback,
        message:
          "Spotify Top Tracks are not currently published. Official Spotify links remain available.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json(
    {
      provider: "spotify",
      status: "unavailable",
      message: "This personal stream has not been published yet.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
