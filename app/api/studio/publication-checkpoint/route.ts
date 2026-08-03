import { authorizeOwnerApi } from "@/lib/server/owner-auth";
import { getPublicationCheckpoint } from "@/lib/server/publication-checkpoint-runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;

  return Response.json(await getPublicationCheckpoint(), {
    headers: {
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
