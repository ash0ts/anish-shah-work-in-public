export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(
    /^\/api\/connectors\//,
    "/api/studio/connectors/",
  );
  return new Response(null, {
    status: 308,
    headers: {
      location: url.toString(),
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
