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

function isSimulationPath(pathname: string): boolean {
  return (
    pathname === "/simulation" ||
    pathname === "/simulation/" ||
    pathname === "/api/simulation" ||
    pathname.startsWith("/api/simulation/")
  );
}

function isPreviewDisabledPath(
  pathname: string,
  simulationExperienceMode: string | undefined,
): boolean {
  return (
    (simulationExperienceMode !== "campaign-v1" &&
      isSimulationPath(pathname)) ||
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

function disabledSimulationResponse(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

/**
 * Fail closed before throttling or body parsing when the hosted release does
 * not expose the campaign. The coming-soon page may remain visible, but its
 * session APIs stay unavailable until campaign-v1 is active.
 */
export function simulationExperienceBoundaryResponse(
  pathname: string,
  simulationExperienceMode: string | undefined,
): Response | null {
  const apiPath =
    pathname === "/api/simulation" || pathname.startsWith("/api/simulation/");
  const disabledPage =
    simulationExperienceMode !== "coming-soon" &&
    (pathname === "/simulation" || pathname === "/simulation/");
  if (
    simulationExperienceMode !== "campaign-v1" &&
    (apiPath || disabledPage)
  ) {
    return disabledSimulationResponse();
  }
  return null;
}

export function hostedDeploymentBoundaryResponse(
  request: Request,
  pathname: string,
  tier: HostedDeploymentTier | null,
  simulationExperienceMode: string | undefined = "disabled",
): Response | null {
  if (tier !== "preview") return null;
  if (
    simulationExperienceMode === "campaign-v1" &&
    isSimulationPath(pathname)
  ) {
    return null;
  }
  if (pathname.startsWith("/api/connector-artwork/")) {
    return neutralPreviewArtwork();
  }
  if (isPreviewDisabledPath(pathname, simulationExperienceMode)) {
    return disabledPreviewResponse();
  }
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
