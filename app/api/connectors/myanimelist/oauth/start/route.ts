export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/api/studio/connectors/myanimelist/oauth/start";
  return new Response(null, {
    status: 308,
    headers: {
      location: url.toString(),
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
