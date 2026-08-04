import {
  getPublicConnectorSnapshot,
  isConnectorProvider,
} from "@/lib/server/connectors";
import {
  projectConnectorSnapshotForPublic,
} from "@/lib/server/connectors/public-gallery";
import { previewConnectorSnapshot } from "@/lib/server/preview-connector-fixtures";

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

  const searchParams = new URL(request.url).searchParams;
  const preview = previewConnectorSnapshot(candidate, searchParams);
  if (preview) {
    return Response.json(
      preview.status === "ready"
        ? {
            ...preview,
            payload: projectConnectorSnapshotForPublic(
              candidate,
              preview.payload,
              searchParams,
            ),
          }
        : preview,
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const snapshot = await getPublicConnectorSnapshot(candidate);
  if (snapshot.status === "unavailable") {
    return Response.json(
      {
        provider: candidate,
        status: "unavailable",
        message: "This personal stream has not been published yet.",
      },
      {
        status: 200,
        headers: { "cache-control": "no-store" },
      },
    );
  }

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
