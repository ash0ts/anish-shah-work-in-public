import {
  isConnectorProvider,
  refreshConnector,
} from "@/lib/server/connectors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "@/lib/server/owner-auth";
import { connectorRefreshResponse } from "./connector-refresh-response";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function connectorRefreshPost(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;

  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  const { provider: candidate } = await context.params;
  if (!isConnectorProvider(candidate)) {
    return Response.json({ error: "Unknown connector." }, { status: 404 });
  }

  const result = await refreshConnector(
    candidate,
    "manual",
    authorization.user.email,
  );
  return connectorRefreshResponse(result);
}
