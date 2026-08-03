import {
  cloudflareAccessConfigured,
  verifyCloudflareAccess,
  verifyCloudflareAccessPrincipal,
} from "../lib/server/cloudflare-access";
import { privateJson } from "./security-headers";
import { isPrivateSitesReferenceHostname } from "./production-origin";
import type { AccessIdentity, WorkerEnv } from "./runtime-types";
import type { HostedDeploymentTier } from "../lib/deployment-environment";

const INTERNAL_EMAIL_HEADER = "x-anish-authenticated-user-email";
const INTERNAL_SOURCE_HEADER = "x-anish-authenticated-auth-source";
const INTERNAL_NONCE_HEADER = "x-anish-csp-nonce";
const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
const SITES_EMAIL_HEADER = "oai-authenticated-user-email";
const SITES_NAME_HEADER = "oai-authenticated-user-full-name";
const SITES_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";

export function isProtectedOwnerPath(pathname: string): boolean {
  return (
    pathname === "/studio" ||
    pathname.startsWith("/studio/") ||
    pathname === "/api/studio" ||
    pathname.startsWith("/api/studio/") ||
    pathname === "/api/connectors/status" ||
    /^\/api\/connectors\/[^/]+\/(?:credentials|refresh)$/.test(pathname) ||
    pathname === "/api/connectors/myanimelist/oauth/start" ||
    pathname === "/api/connectors/strava/config"
  );
}

const STAGING_PUBLIC_OAUTH_CALLBACKS = new Set([
  "/api/connectors/myanimelist/oauth/callback",
  "/api/connectors/spotify/oauth/callback",
  "/api/connectors/discogs/oauth/callback",
]);

export function requiresHostedAccessIdentity(
  pathname: string,
  tier: HostedDeploymentTier | null,
): boolean {
  if (tier === "staging") return !STAGING_PUBLIC_OAUTH_CALLBACKS.has(pathname);
  if (tier === "preview") return true;
  return isProtectedOwnerPath(pathname);
}

export function isSitesRuntime(hostname: string): boolean {
  return isPrivateSitesReferenceHostname(hostname);
}

function accessFailure(pathname: string, configured: boolean): Response {
  const status = configured ? 401 : 503;
  if (pathname.startsWith("/api/")) {
    return privateJson(
      configured
        ? "Cloudflare Access authorization is required."
        : "Cloudflare Access is not configured.",
      configured ? "access_required" : "access_setup_required",
      status,
    );
  }
  return new Response(
    configured
      ? "Cloudflare Access authorization is required."
      : "Cloudflare Access is not configured.",
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "text/plain; charset=utf-8",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    },
  );
}

type AuthenticateRequestResult =
  | {
      status: "allowed";
      headers: Headers;
      identity: AccessIdentity | null;
      accessMode: boolean;
    }
  | { status: "denied"; response: Response; accessMode: boolean };

export async function authenticateRequest(
  request: Request,
  env: WorkerEnv,
  options: {
    pathname: string;
    directProduction: boolean;
    sitesRuntime: boolean;
    deploymentTier?: HostedDeploymentTier | null;
  },
): Promise<AuthenticateRequestResult> {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_EMAIL_HEADER);
  headers.delete(INTERNAL_SOURCE_HEADER);
  headers.delete(INTERNAL_NONCE_HEADER);
  headers.delete(ACCESS_ASSERTION_HEADER);

  // Sites supplies its own authenticated identity headers. On a direct
  // Worker/custom-domain deployment those headers are untrusted input.
  if (!options.sitesRuntime) {
    headers.delete(SITES_EMAIL_HEADER);
    headers.delete(SITES_NAME_HEADER);
    headers.delete(SITES_NAME_ENCODING_HEADER);
  }

  const accessMode = env.AUTH_MODE === "cloudflare_access";
  const identityRequired = requiresHostedAccessIdentity(
    options.pathname,
    options.deploymentTier ?? null,
  );
  if (
    options.directProduction &&
    identityRequired &&
    !accessMode
  ) {
    return {
      status: "denied",
      response: accessFailure(options.pathname, false),
      accessMode,
    };
  }

  let identity: AccessIdentity | null = null;
  let accessAuthenticated = false;
  if (accessMode) {
    const configuration = {
      audience: env.CF_ACCESS_AUD,
      teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    };
    if (options.deploymentTier === "preview") {
      const principal = await verifyCloudflareAccessPrincipal(
        request,
        configuration,
      );
      accessAuthenticated = Boolean(principal);
      identity = principal?.kind === "user" ? { email: principal.email } : null;
    } else {
      identity = await verifyCloudflareAccess(request, configuration);
      accessAuthenticated = Boolean(identity);
    }
    if (identity) {
      headers.set(INTERNAL_EMAIL_HEADER, identity.email);
      headers.set(INTERNAL_SOURCE_HEADER, "cloudflare-access");
    }
    if (identityRequired && !accessAuthenticated) {
      return {
        status: "denied",
        response: accessFailure(
          options.pathname,
          cloudflareAccessConfigured({
            audience: env.CF_ACCESS_AUD,
            teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
          }),
        ),
        accessMode,
      };
    }
  }

  return { status: "allowed", headers, identity, accessMode };
}
