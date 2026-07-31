import {
  credentialDelete,
  credentialPost,
} from "@/lib/server/http/connector-credentials";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  return credentialPost(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return credentialDelete(request, context);
}
