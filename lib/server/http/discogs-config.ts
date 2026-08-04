import {
  getDiscogsExtendedDisplayApproval,
  getDiscogsPresentationConfig,
  saveDiscogsExtendedDisplayApproval,
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
  const [presentation, approval] = await Promise.all([
    getDiscogsPresentationConfig(),
    getDiscogsExtendedDisplayApproval(),
  ]);
  const ready = presentation.status === "ready" && approval.status === "ready";
  return Response.json(
    ready
      ? {
          status: "ready",
          config: presentation.config,
          extendedDisplayApproval: approval.approval,
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
    "extendedDisplayApproval",
  ]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) {
    return Response.json(
      { error: "Discogs presentation settings contain an unknown field." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const hasPresentation = Object.hasOwn(candidate, "publishCollection");
  const hasApproval = Object.hasOwn(candidate, "extendedDisplayApproval");
  if (hasPresentation === hasApproval) {
    return Response.json(
      {
        error:
          "Update either Discogs presentation settings or the extended-display approval in one request.",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  if (hasApproval) {
    if (Object.hasOwn(candidate, "acknowledgeNoncommercial")) {
      return Response.json(
        { error: "The extended-display approval contains an unknown field." },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    const value = candidate.extendedDisplayApproval;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return Response.json(
        { error: "extendedDisplayApproval must be a JSON object." },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    const approval = value as Record<string, unknown>;
    const approvalKeys = new Set([
      "provider",
      "reference",
      "approvedAt",
      "expiresAt",
      "enabled",
    ]);
    if (
      Object.keys(approval).length !== approvalKeys.size ||
      Object.keys(approval).some((key) => !approvalKeys.has(key)) ||
      approval.provider !== "discogs" ||
      typeof approval.reference !== "string" ||
      typeof approval.approvedAt !== "string" ||
      !(approval.expiresAt === null || typeof approval.expiresAt === "string") ||
      typeof approval.enabled !== "boolean"
    ) {
      return Response.json(
        { error: "The extended-display approval is invalid." },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    const result = await saveDiscogsExtendedDisplayApproval({
      provider: "discogs",
      reference: approval.reference,
      approvedAt: approval.approvedAt,
      expiresAt: approval.expiresAt as string | null,
      enabled: approval.enabled,
      actorEmail: authorization.user.email,
    });
    const error =
      result.status === "invalid"
        ? "The extended-display approval is invalid."
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
