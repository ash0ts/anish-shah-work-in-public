import {
  getPublicContentViewFromStores,
  PublicContentUnavailableError,
} from "../lib/server/public-content";
import type { WorkerEnv } from "./runtime-types";
import { previewFixtureRuntime } from "../lib/deployment-environment";

function isContentBackedPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/play" ||
    pathname === "/play/" ||
    pathname === "/sources" ||
    pathname === "/sources/" ||
    pathname === "/work" ||
    pathname === "/work/" ||
    pathname.startsWith("/work/") ||
    pathname === "/sitemap.xml"
  );
}

function publicContentUnavailableResponse(): Response {
  return new Response(
    "The current publication is temporarily unavailable. Please try again shortly.",
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "60",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    },
  );
}

export async function publicationAvailabilityResponse(
  request: Request,
  env: WorkerEnv,
  directProduction: boolean,
  pathname = new URL(request.url).pathname,
): Promise<Response | null> {
  if (
    !directProduction ||
    !["GET", "HEAD"].includes(request.method) ||
    !isContentBackedPublicPath(pathname)
  ) {
    return null;
  }
  if (previewFixtureRuntime(env)) return null;
  if (env.PUBLIC_CONTENT_MODE !== "d1_kv_required") {
    return publicContentUnavailableResponse();
  }
  try {
    await getPublicContentViewFromStores(
      env.DB ?? null,
      env.PUBLICATION_CACHE ?? null,
      { failClosed: true },
    );
    return null;
  } catch (error) {
    if (error instanceof PublicContentUnavailableError) {
      return publicContentUnavailableResponse();
    }
    throw error;
  }
}
