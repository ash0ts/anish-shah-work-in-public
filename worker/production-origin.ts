import { PUBLIC_SITE_ORIGIN } from "../lib/site-constants";
import type { WorkerEnv } from "./runtime-types";

const PUBLIC_SITE_URL = new URL(PUBLIC_SITE_ORIGIN);
export const PRIVATE_SITES_REFERENCE_ORIGIN =
  "https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site";
const PRIVATE_SITES_REFERENCE_URL = new URL(PRIVATE_SITES_REFERENCE_ORIGIN);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isPrivateSitesReferenceHostname(hostname: string): boolean {
  return hostname.toLocaleLowerCase() === PRIVATE_SITES_REFERENCE_URL.hostname;
}

function isLoopbackDevelopmentOrigin(
  requestUrl: URL,
  development: boolean,
): boolean {
  return (
    development &&
    requestUrl.protocol === "http:" &&
    !requestUrl.username &&
    !requestUrl.password &&
    LOOPBACK_HOSTNAMES.has(requestUrl.hostname.toLocaleLowerCase())
  );
}

function isPrivateSitesReferenceOrigin(
  requestUrl: URL,
  sitesRuntime: boolean,
): boolean {
  return sitesRuntime && requestUrl.origin === PRIVATE_SITES_REFERENCE_ORIGIN;
}

function unavailableResponse(): Response {
  return new Response("The canonical production origin is not configured.", {
    status: 503,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "60",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

function misdirectedResponse(): Response {
  return new Response("This hostname does not serve the application.", {
    status: 421,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

export function productionOriginResponse(
  request: Request,
  env: WorkerEnv,
  options: { development: boolean; sitesRuntime: boolean },
): Response | null {
  const requestUrl = new URL(request.url);
  if (
    isLoopbackDevelopmentOrigin(requestUrl, options.development) ||
    isPrivateSitesReferenceOrigin(requestUrl, options.sitesRuntime)
  ) {
    return null;
  }

  if (requestUrl.origin !== PUBLIC_SITE_ORIGIN) {
    return misdirectedResponse();
  }

  if (
    env.SITE_URL !== PUBLIC_SITE_ORIGIN ||
    env.PRODUCTION_SITE_URL !== PUBLIC_SITE_ORIGIN
  ) {
    return unavailableResponse();
  }

  // The origin equality check above includes protocol and port. Keep this
  // assertion close to the canonical URL so a future constant change cannot
  // silently widen the accepted production surface.
  if (requestUrl.origin !== PUBLIC_SITE_URL.origin) return misdirectedResponse();

  return null;
}
