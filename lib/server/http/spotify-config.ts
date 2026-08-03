import {
  getSpotifyPresentationConfig,
  saveSpotifyPresentationConfig,
} from "@/lib/server/connectors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { readBoundedJsonBody } from "@/lib/server/request-security";

export async function spotifyConfigGet(): Promise<Response> {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  const result = await getSpotifyPresentationConfig();
  return Response.json(result, {
    status: result.status === "ready" ? 200 : 503,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function spotifyConfigPut(request: Request): Promise<Response> {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  const parsed = await readBoundedJsonBody(request, { maxBytes: 16_384 });
  if (!parsed.ok) return parsed.response;
  if (
    typeof parsed.value !== "object" ||
    parsed.value === null ||
    Array.isArray(parsed.value)
  ) {
    return Response.json(
      { error: "Spotify presentation settings must be a JSON object." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  const candidate = parsed.value as Record<string, unknown>;
  if (typeof candidate.publishTopTracks !== "boolean") {
    return Response.json(
      { error: "publishTopTracks must be true or false." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (
    Object.hasOwn(candidate, "fallbackEmbed") &&
    candidate.fallbackEmbed !== null &&
    typeof candidate.fallbackEmbed !== "string"
  ) {
    return Response.json(
      { error: "fallbackEmbed must be an official Spotify URL, iframe, or null." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (
    Object.hasOwn(candidate, "acknowledgePublicDisplay") &&
    typeof candidate.acknowledgePublicDisplay !== "boolean"
  ) {
    return Response.json(
      { error: "acknowledgePublicDisplay must be true or false." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  const result = await saveSpotifyPresentationConfig({
    publishTopTracks: candidate.publishTopTracks,
    ...(Object.hasOwn(candidate, "fallbackEmbed")
      ? { fallbackEmbed: candidate.fallbackEmbed as string | null }
      : {}),
    acknowledgePublicDisplay:
      candidate.acknowledgePublicDisplay === true,
    actorEmail: authorization.user.email,
  });
  const error =
    result.status === "invalid"
      ? result.reason === "acknowledgement"
        ? "Acknowledge the public display before publishing Spotify Top Tracks."
        : "Use an official open.spotify.com track, album, or playlist URL."
      : result.status === "setup_required"
        ? "The site database is not ready."
        : undefined;
  return Response.json(error ? { ...result, error } : result, {
    status:
      result.status === "saved"
        ? 200
        : result.status === "invalid"
          ? 400
          : 503,
    headers: { "cache-control": "private, no-store" },
  });
}
