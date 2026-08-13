import { connectorPublicationApprovalPut } from "@/lib/server/http/connector-publication-approvals";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  return connectorPublicationApprovalPut(request, provider);
}
