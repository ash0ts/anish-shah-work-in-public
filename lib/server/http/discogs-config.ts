import {
  getDiscogsPresentationConfig,
  saveDiscogsPresentationConfig,
} from "@/lib/server/connectors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { readBoundedJsonBody } from "@/lib/server/request-security";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export async function discogsConfigGet(): Promise<Response> {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  const presentation = await getDiscogsPresentationConfig();
  const ready = presentation.status === "ready";
  return Response.json(
    ready
      ? {
          status: "ready",
          config: presentation.config,
        }
      : { status: "setup_required" },
    {
      status: ready ? 200 : 503,
      headers: PRIVATE_HEADERS,
    },
  );
}

export async function discogsConfigPut(request: Request): Promise<Response> {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  const parsed = await readBoundedJsonBody(request, { maxBytes: 4_096 });
  if (!parsed.ok) return parsed.response;
  if (
    typeof parsed.value !== "object" ||
    parsed.value === null ||
    Array.isArray(parsed.value)
  ) {
    return Response.json(
      { error: "Discogs presentation settings must be a JSON object." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const candidate = parsed.value as Record<string, unknown>;
  const allowed = new Set([
    "publishCollection",
    "acknowledgeNoncommercial",
  ]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) {
    return Response.json(
      { error: "Discogs presentation settings contain an unknown field." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  if (typeof candidate.publishCollection !== "boolean") {
    return Response.json(
      { error: "publishCollection must be true or false." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  if (
    Object.hasOwn(candidate, "acknowledgeNoncommercial") &&
    typeof candidate.acknowledgeNoncommercial !== "boolean"
  ) {
    return Response.json(
      { error: "acknowledgeNoncommercial must be true or false." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const result = await saveDiscogsPresentationConfig({
    publishCollection: candidate.publishCollection,
    acknowledgeNoncommercial:
      candidate.acknowledgeNoncommercial === true,
    actorEmail: authorization.user.email,
  });
  const error =
    result.status === "invalid"
      ? result.reason === "acknowledgement"
        ? "Acknowledge the personal, noncommercial public display before publishing the Discogs collection."
        : result.reason === "approval"
          ? "Allow public use for Discogs before publishing the collection."
          : "Refresh Discogs successfully and review its current snapshot before publishing the collection."
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
    headers: PRIVATE_HEADERS,
  });
}
