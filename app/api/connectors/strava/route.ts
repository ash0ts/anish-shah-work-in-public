import { getStravaPublicConfig } from "@/lib/server/strava-config";

export const dynamic = "force-dynamic";

export async function GET() {
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
      message: "This personal stream has not been published yet.",
    },
    {
      status: result.reason === "database_unavailable" ? 503 : 404,
      headers: { "cache-control": "no-store" },
    },
  );
}
