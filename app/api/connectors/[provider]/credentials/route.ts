export const dynamic = "force-dynamic";

function canonicalOwnerRoute(request: Request): Response {
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

export async function POST(request: Request) {
  return canonicalOwnerRoute(request);
}

export async function DELETE(request: Request) {
  return canonicalOwnerRoute(request);
}
