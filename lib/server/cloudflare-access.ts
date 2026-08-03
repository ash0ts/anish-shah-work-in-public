import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
const MAX_ACCESS_TOKEN_BYTES = 16_384;

export type CloudflareAccessConfiguration = {
  audience?: string;
  teamDomain?: string;
};

export type CloudflareAccessPrincipal =
  | { kind: "user"; email: string }
  | { kind: "service"; commonName: string };

type VerificationOptions = {
  keyResolver?: JWTVerifyGetKey;
  nowSeconds?: number;
};

const remoteKeyResolvers = new Map<string, JWTVerifyGetKey>();

function accessOrigin(raw: string | undefined): URL | null {
  const value = raw?.trim();
  if (!value || value.length > 255) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".cloudflareaccess.com") ||
      url.port ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return new URL(url.origin);
  } catch {
    return null;
  }
}

function expectedAudiences(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[A-Za-z0-9_-]{8,160}$/.test(value)),
  );
}

function accessToken(request: Request): string | null {
  const assertion = request.headers.get(ACCESS_ASSERTION_HEADER)?.trim();
  if (assertion) return assertion;

  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "CF_Authorization") {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}

function remoteKeyResolver(origin: URL): JWTVerifyGetKey {
  const endpoint = new URL("/cdn-cgi/access/certs", origin).toString();
  const cached = remoteKeyResolvers.get(endpoint);
  if (cached) return cached;

  const resolver = createRemoteJWKSet(new URL(endpoint), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 5 * 60 * 1_000,
  });
  remoteKeyResolvers.set(endpoint, resolver);
  return resolver;
}

export function cloudflareAccessConfigured(
  configuration: CloudflareAccessConfiguration,
): boolean {
  return Boolean(
    accessOrigin(configuration.teamDomain) &&
      expectedAudiences(configuration.audience).size,
  );
}

/**
 * Verify the Access assertion before trusting any identity forwarded by the
 * edge. Verification failures intentionally collapse to null so callers fail
 * closed without exposing token or claim details.
 */
export async function verifyCloudflareAccessPrincipal(
  request: Request,
  configuration: CloudflareAccessConfiguration,
  options: VerificationOptions = {},
): Promise<CloudflareAccessPrincipal | null> {
  const token = accessToken(request);
  const origin = accessOrigin(configuration.teamDomain);
  const audiences = expectedAudiences(configuration.audience);
  if (
    !token ||
    token.length > MAX_ACCESS_TOKEN_BYTES ||
    !origin ||
    !audiences.size
  ) {
    return null;
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  try {
    const { payload } = await jwtVerify(
      token,
      options.keyResolver ?? remoteKeyResolver(origin),
      {
        algorithms: ["RS256"],
        audience: [...audiences],
        clockTolerance: 30,
        currentDate: new Date(now * 1_000),
        issuer: origin.origin,
      },
    );

    if (
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= now ||
      (typeof payload.iat === "number" && payload.iat > now + 30)
    ) {
      return null;
    }
    if (
      typeof payload.email === "string" &&
      payload.email.length <= 320 &&
      /^[^\s@]+@[^\s@]+$/.test(payload.email)
    ) {
      return { kind: "user", email: payload.email };
    }
    // Cloudflare application tokens use `type: "app"` for both identity and
    // service-token authentication. A service principal is distinguished by
    // its generated common_name and intentionally empty subject claim.
    if (
      payload.type === "app" &&
      payload.sub === "" &&
      typeof payload.common_name === "string" &&
      /^[A-Za-z0-9._:-]{1,160}$/.test(payload.common_name)
    ) {
      return { kind: "service", commonName: payload.common_name };
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyCloudflareAccess(
  request: Request,
  configuration: CloudflareAccessConfiguration,
  options: VerificationOptions = {},
): Promise<{ email: string } | null> {
  const principal = await verifyCloudflareAccessPrincipal(
    request,
    configuration,
    options,
  );
  return principal?.kind === "user" ? { email: principal.email } : null;
}
