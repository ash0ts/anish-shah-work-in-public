import type { HostedDeploymentTier } from "../lib/deployment-environment";

function disabledPreviewResponse(): Response {
  return new Response("This route is not available in visual previews.", {
    status: 404,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

function neutralPreviewArtwork(): Response {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">',
    '<rect width="320" height="320" fill="#e7e3da"/>',
    '<path d="M56 72h208v176H56z" fill="none" stroke="#17223b" stroke-width="8"/>',
    '<path d="M88 216l48-48 32 32 40-56 40 72" fill="none" stroke="#295dff" stroke-width="8"/>',
    '<circle cx="112" cy="120" r="16" fill="#17223b"/>',
    "</svg>",
  ].join("");
  return new Response(svg, {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "image/svg+xml; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-preview-artwork": "neutral-placeholder",
      "x-robots-tag": "noindex, nofollow, noarchive, noimageindex",
    },
  });
}

function isPreviewDisabledPath(pathname: string): boolean {
  return (
    pathname === "/studio" ||
    pathname.startsWith("/studio/") ||
    pathname === "/api/studio" ||
    pathname.startsWith("/api/studio/") ||
    pathname === "/api/play-promotion/import" ||
    pathname === "/signin-with-chatgpt" ||
    pathname === "/signout-with-chatgpt" ||
    pathname === "/callback" ||
    /^\/api\/connectors\/[^/]+\/(?:credentials|refresh)$/.test(pathname) ||
    /^\/api\/connectors\/[^/]+\/oauth\/(?:start|callback)$/.test(pathname) ||
    pathname === "/api/connectors/strava/config"
  );
}

export function hostedDeploymentBoundaryResponse(
  request: Request,
  tier: HostedDeploymentTier | null,
): Response | null {
  if (tier !== "preview") return null;
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/connector-artwork/")) {
    return neutralPreviewArtwork();
  }
  if (isPreviewDisabledPath(pathname)) return disabledPreviewResponse();
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Visual previews are read-only.", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "cache-control": "private, no-store",
        "content-type": "text/plain; charset=utf-8",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    });
  }
  return null;
}
