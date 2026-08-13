import { connectorPublicationApprovalsActivatePost } from "@/lib/server/http/connector-publication-approvals";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return connectorPublicationApprovalsActivatePost(request);
}
