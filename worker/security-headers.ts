const INTERNAL_NONCE_HEADER = "x-anish-csp-nonce";

export function isPrivatePath(pathname: string): boolean {
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

export function securityPolicy(
  nonce: string,
  development: boolean,
): string {
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
    "frame-src https://open.spotify.com https://strava-embeds.com https://www.strava.com",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function nonceValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function privateJson(
  error: string,
  code: string,
  status: number,
): Response {
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

export function withRequestSecurityHeaders(
  headers: Headers,
  nonce: string,
  development: boolean,
): void {
  headers.set("content-security-policy", securityPolicy(nonce, development));
  headers.set(INTERNAL_NONCE_HEADER, nonce);
}

export function securedResponse(
  response: Response,
  request: Request,
  nonce: string,
  development: boolean,
  pathname = new URL(request.url).pathname,
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
  if (isPrivatePath(pathname)) {
    headers.set("cache-control", "private, no-store");
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  } else if (pathname === "/play" || pathname === "/play/") {
    // Play includes publication-gated provider state in its server-rendered
    // fallback. Never let a shared cache outlive an unpublish or disconnect.
    headers.set("cache-control", "private, no-store");
  } else if (isPublicHtmlRequest(request, pathname) && response.ok) {
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
