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

  const needsReplacement = result.reason === "legacy_embed";
  return Response.json(
    {
      status: "unavailable",
      provider: "strava",
      code: needsReplacement ? "legacy_embed" : result.reason,
      message: needsReplacement
        ? "The saved Strava profile widget now redirects to sign-in. Replace it in Studio with a current public activity or route embed."
        : "This personal stream has not been published yet.",
    },
    {
      status:
        result.reason === "database_unavailable"
          ? 503
          : needsReplacement
            ? 409
            : 404,
      headers: { "cache-control": "no-store" },
    },
  );
}
