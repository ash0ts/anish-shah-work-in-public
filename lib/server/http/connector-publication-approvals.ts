import {
  CONNECTOR_PUBLICATION_APPROVAL_SCOPES,
  activateConnectorPublicationApprovals,
  getConnectorPublicationApprovalOverview,
  isPublicConnectorProvider,
  saveConnectorPublicationApproval,
} from "@/lib/server/connectors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { readBoundedJsonBody } from "@/lib/server/request-security";

const NO_STORE = { "cache-control": "private, no-store" } as const;

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasFixedApprovalScopes(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return (
    value.length === CONNECTOR_PUBLICATION_APPROVAL_SCOPES.length &&
    CONNECTOR_PUBLICATION_APPROVAL_SCOPES.every((scope) =>
      value.includes(scope),
    )
  );
}

async function authorizeWrite(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return { ok: false, response: crossOrigin } as const;
  const authorization = await authorizeOwnerApi();
  return authorization.ok
    ? { ok: true, user: authorization.user } as const
    : { ok: false, response: authorization.response } as const;
}

export async function connectorPublicationApprovalsGet(): Promise<Response> {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  const result = await getConnectorPublicationApprovalOverview();
  return Response.json(result, {
    status: result.status === "ready" ? 200 : 503,
    headers: NO_STORE,
  });
}

export async function connectorPublicationApprovalPut(
  request: Request,
  providerValue: string,
): Promise<Response> {
  const authorization = await authorizeWrite(request);
  if (!authorization.ok) return authorization.response;
  if (!isPublicConnectorProvider(providerValue)) {
    return Response.json({ error: "Unknown connector provider." }, { status: 404, headers: NO_STORE });
  }
  const parsed = await readBoundedJsonBody(request, { maxBytes: 4_096 });
  if (!parsed.ok) return parsed.response;
  if (
    typeof parsed.value !== "object" ||
    parsed.value === null ||
    Array.isArray(parsed.value)
  ) {
    return Response.json({ error: "Approval must be a JSON object." }, { status: 400, headers: NO_STORE });
  }
  const body = parsed.value as Record<string, unknown>;
  if (
    !exactKeys(body, ["reference", "scopes", "approvedAt", "expiresAt", "enabled"]) ||
    (body.reference !== undefined && typeof body.reference !== "string") ||
    !hasFixedApprovalScopes(body.scopes) ||
    typeof body.approvedAt !== "string" ||
    !(body.expiresAt === null || typeof body.expiresAt === "string") ||
    typeof body.enabled !== "boolean"
  ) {
    return Response.json({ error: "Approval fields are invalid." }, { status: 400, headers: NO_STORE });
  }
  const result = await saveConnectorPublicationApproval({
    provider: providerValue,
    ...(body.reference === undefined ? {} : { reference: body.reference }),
    scopes: [...CONNECTOR_PUBLICATION_APPROVAL_SCOPES],
    approvedAt: body.approvedAt,
    expiresAt: body.expiresAt,
    enabled: body.enabled,
    actorEmail: authorization.user.email,
  });
  return Response.json(result, {
    status: result.status === "saved" ? 200 : result.status === "invalid" ? 400 : 503,
    headers: NO_STORE,
  });
}

export async function connectorPublicationApprovalsActivatePost(
  request: Request,
): Promise<Response> {
  const authorization = await authorizeWrite(request);
  if (!authorization.ok) return authorization.response;
  const parsed = await readBoundedJsonBody(request, { maxBytes: 128 });
  if (!parsed.ok) return parsed.response;
  if (
    typeof parsed.value !== "object" ||
    parsed.value === null ||
    Array.isArray(parsed.value) ||
    Object.keys(parsed.value as Record<string, unknown>).length !== 0
  ) {
    return Response.json({ error: "Activation body must be an empty JSON object." }, { status: 400, headers: NO_STORE });
  }
  const result = await activateConnectorPublicationApprovals({
    actorEmail: authorization.user.email,
  });
  return Response.json(result, {
    status: result.status === "activated" ? 200 : result.status === "incomplete" ? 409 : 503,
    headers: NO_STORE,
  });
}
