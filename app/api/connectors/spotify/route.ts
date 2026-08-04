import {
  getPublicConnectorSnapshot,
  getSpotifyPublicFallback,
} from "@/lib/server/connectors";
import {
  projectConnectorSnapshotForPublic,
} from "@/lib/server/connectors/public-gallery";
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
