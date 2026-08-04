import { publicTravelMediaGet } from "@/lib/server/travel/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ photoId: string; variant: string; digest: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  return publicTravelMediaGet(context);
}

export async function HEAD(_request: Request, context: RouteContext) {
  const response = await publicTravelMediaGet(context);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
