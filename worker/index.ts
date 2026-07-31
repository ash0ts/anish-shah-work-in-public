/** Cloudflare Worker entry point for Anish Shah’s public portfolio. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  cloudflareAccessConfigured,
  verifyCloudflareAccess,
} from "../lib/server/cloudflare-access";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
  AUTH_MODE?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  NODE_ENV?: string;
  RATE_LIMIT_SALT?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const INTERNAL_EMAIL_HEADER = "x-anish-authenticated-user-email";
const INTERNAL_SOURCE_HEADER = "x-anish-authenticated-auth-source";
const INTERNAL_NONCE_HEADER = "x-anish-csp-nonce";
const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
const SITES_EMAIL_HEADER = "oai-authenticated-user-email";
const SITES_NAME_HEADER = "oai-authenticated-user-full-name";
const SITES_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const WRITE_BODY_LIMIT_BYTES = 16_384;
const PROMOTION_BODY_LIMIT_BYTES = 65_536;
const OWNER_RATE_LIMIT = 30;
const ARTWORK_RATE_LIMIT = 120;
const PROMOTION_IMPORT_RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60_000;

const requestBuckets = new Map<
  string,
  { count: number; expiresAt: number }
>();

function isProtectedOwnerPath(pathname: string): boolean {
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

function isPrivatePath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === "/studio" ||
    pathname.startsWith("/studio/") ||
    pathname === "/signin-with-chatgpt" ||
    pathname === "/signout-with-chatgpt" ||
    pathname === "/callback"
  );
}

function isPublicHtmlRequest(request: Request, pathname: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (isPrivatePath(pathname) || pathname.startsWith("/_")) return false;
  if (new URL(request.url).search) return false;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

function securityPolicy(nonce: string, development: boolean): string {
  const scriptSources = development
    ? `'self' 'nonce-${nonce}' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const connectSources = development ? "'self' ws: wss:" : "'self'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources}`,
    "media-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src https://strava-embeds.com https://www.strava.com",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function nonceValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function privateJson(error: string, code: string, status: number): Response {
  return Response.json(
    { error, code },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    },
  );
}

async function boundedApiWrite(
  request: Request,
  pathname: string,
): Promise<Request | Response> {
  if (
    !["POST", "PUT", "PATCH", "DELETE"].includes(request.method) ||
    !pathname.startsWith("/api/") ||
    !request.body
  ) {
    return request;
  }
  const maxBytes =
    pathname === "/api/play-promotion/import"
      ? PROMOTION_BODY_LIMIT_BYTES
      : WRITE_BODY_LIMIT_BYTES;
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    return privateJson("Request body is too large.", "request_too_large", 413);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return privateJson(
          "Request body is too large.",
          "request_too_large",
          413,
        );
      }
      chunks.push(value);
    }
  } catch {
    return privateJson("Request body could not be read.", "invalid_body", 400);
  }
  if (size > 0) {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      return privateJson(
        "Content-Type must be application/json.",
        "invalid_media_type",
        415,
      );
    }
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.set("content-length", String(size));
  // The original stream has been consumed by the size check, so rebuilding
  // from it throws in Workers even when the request body was empty. Recreate
  // the request from its URL and explicit safe fields instead.
  return new Request(request.url, {
    method: request.method,
    headers,
    body: size ? body : undefined,
    redirect: request.redirect,
    signal: request.signal,
  });
}

async function oneWayBucketKey(
  env: Env,
  request: Request,
  namespace: string,
  identity?: string,
): Promise<string | null> {
  const salt = env.RATE_LIMIT_SALT?.trim();
  const source = identity ?? request.headers.get("cf-connecting-ip")?.trim();
  if (!salt || salt.length < 32 || !source) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${namespace}:${source}`),
    ),
  );
  return `${namespace}:${Array.from(signature.slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function consumeBucket(key: string, limit: number): number | null {
  const now = Date.now();
  if (requestBuckets.size > 2_048) {
    for (const [candidate, bucket] of requestBuckets) {
      if (bucket.expiresAt <= now) requestBuckets.delete(candidate);
    }
  }
  const current = requestBuckets.get(key);
  if (!current || current.expiresAt <= now) {
    requestBuckets.set(key, { count: 1, expiresAt: now + RATE_WINDOW_MS });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  return Math.max(1, Math.ceil((current.expiresAt - now) / 1_000));
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

function securedResponse(
  response: Response,
  request: Request,
  nonce: string,
  development: boolean,
): Response {
  if (response.status === 101) return response;
  const url = new URL(request.url);
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", securityPolicy(nonce, development));
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  );
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  if (url.protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000");
  }
  if (isPrivatePath(url.pathname)) {
    headers.set("cache-control", "private, no-store");
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  } else if (isPublicHtmlRequest(request, url.pathname) && response.ok) {
    headers.set(
      "cache-control",
      "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const development = env.NODE_ENV === "development";
    const nonce = nonceValue();
    let appRequest = request;

    const headers = new Headers(appRequest.headers);
    headers.delete(INTERNAL_EMAIL_HEADER);
    headers.delete(INTERNAL_SOURCE_HEADER);
    headers.delete(INTERNAL_NONCE_HEADER);

    let accessIdentity: { email: string } | null = null;
    const accessMode = env.AUTH_MODE === "cloudflare_access";
    if (accessMode) {
      headers.delete(SITES_EMAIL_HEADER);
      headers.delete(SITES_NAME_HEADER);
      headers.delete(SITES_NAME_ENCODING_HEADER);
      accessIdentity = await verifyCloudflareAccess(appRequest, {
        audience: env.CF_ACCESS_AUD,
        teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
      });
      headers.delete(ACCESS_ASSERTION_HEADER);
      if (accessIdentity) {
        headers.set(INTERNAL_EMAIL_HEADER, accessIdentity.email);
        headers.set(INTERNAL_SOURCE_HEADER, "cloudflare-access");
      }
      if (isProtectedOwnerPath(url.pathname) && !accessIdentity) {
        return securedResponse(
          accessFailure(
            url.pathname,
            cloudflareAccessConfigured({
              audience: env.CF_ACCESS_AUD,
              teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
            }),
          ),
          request,
          nonce,
          development,
        );
      }
    }
    if (
      accessMode &&
      (!env.RATE_LIMIT_SALT || env.RATE_LIMIT_SALT.trim().length < 32) &&
      (isProtectedOwnerPath(url.pathname) ||
        url.pathname.startsWith("/api/connector-artwork/") ||
        url.pathname === "/api/play-promotion/import")
    ) {
      return securedResponse(
        privateJson(
          "Request throttling is not configured.",
          "rate_limit_setup_required",
          503,
        ),
        request,
        nonce,
        development,
      );
    }
    headers.set("content-security-policy", securityPolicy(nonce, development));
    headers.set(INTERNAL_NONCE_HEADER, nonce);
    appRequest = new Request(appRequest, { headers });

    if (
      appRequest.method === "POST" &&
      url.pathname === "/api/play-promotion/import"
    ) {
      const key = await oneWayBucketKey(
        env,
        appRequest,
        "promotion-import",
      );
      const retryAfter = key
        ? consumeBucket(key, PROMOTION_IMPORT_RATE_LIMIT)
        : null;
      if (retryAfter) {
        const limited = privateJson(
          "Too many promotion attempts. Try again shortly.",
          "rate_limited",
          429,
        );
        limited.headers.set("retry-after", String(retryAfter));
        return securedResponse(limited, request, nonce, development);
      }
    }

    const bounded = await boundedApiWrite(appRequest, url.pathname);
    if (bounded instanceof Response) {
      return securedResponse(bounded, request, nonce, development);
    }
    appRequest = bounded;

    if (
      accessIdentity &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(appRequest.method) &&
      isProtectedOwnerPath(url.pathname)
    ) {
      const key = await oneWayBucketKey(
        env,
        appRequest,
        "owner-write",
        accessIdentity.email.toLocaleLowerCase(),
      );
      const retryAfter = key ? consumeBucket(key, OWNER_RATE_LIMIT) : null;
      if (retryAfter) {
        const limited = privateJson(
          "Too many owner requests. Try again shortly.",
          "rate_limited",
          429,
        );
        limited.headers.set("retry-after", String(retryAfter));
        return securedResponse(limited, request, nonce, development);
      }
    }

    if (url.pathname.startsWith("/api/connector-artwork/")) {
      const key = await oneWayBucketKey(env, appRequest, "artwork");
      const retryAfter = key ? consumeBucket(key, ARTWORK_RATE_LIMIT) : null;
      if (retryAfter) {
        const limited = privateJson(
          "Artwork requests are temporarily limited.",
          "rate_limited",
          429,
        );
        limited.headers.set("retry-after", String(retryAfter));
        return securedResponse(limited, request, nonce, development);
      }
    }

    let response: Response;
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      response = await handleImageOptimization(
        appRequest,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, appRequest.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    } else {
      response = await handler.fetch(appRequest, env, ctx);
    }

    return securedResponse(response, request, nonce, development);
  },
};

export default worker;
