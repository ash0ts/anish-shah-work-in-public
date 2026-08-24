import { getStravaPublicConfig } from "@/lib/server/strava-config";
import { previewStravaSnapshot } from "@/lib/server/preview-connector-fixtures";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const preview = previewStravaSnapshot(new URL(request.url).searchParams);
  if (preview) {
    return Response.json(preview, {
      headers: { "cache-control": "private, no-store" },
    });
  }
  const result = await getStravaPublicConfig();
  if (result.status === "ready") {
    return Response.json(
      {
        status: "ready",
        provider: "strava",
        payload: result.config,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return Response.json(
    {
      status: "unavailable",
      provider: "strava",
      code: result.reason,
      message: "This public view has not been published yet.",
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
