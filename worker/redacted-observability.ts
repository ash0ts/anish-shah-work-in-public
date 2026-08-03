type RouteClass =
  | "oauth_callback"
  | "owner_api"
  | "owner_ui"
  | "public_api"
  | "public_page"
  | "asset_request";

export type RequestObservation = {
  requestId: string;
  method: string;
  routeClass: RouteClass;
  releaseShaPrefix: string;
  startedAt: number;
};

function classifyRoute(pathname: string): RouteClass {
  if (pathname.includes("/oauth/callback")) return "oauth_callback";
  if (pathname === "/studio" || pathname.startsWith("/studio/")) {
    return "owner_ui";
  }
  if (pathname === "/api/studio" || pathname.startsWith("/api/studio/")) {
    return "owner_api";
  }
  if (pathname.startsWith("/api/")) return "public_api";
  if (
    pathname === "/_vinext/image" ||
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/fonts/") ||
    pathname === "/favicon.png" ||
    pathname === "/og.jpg" ||
    pathname === "/spotify-full-logo-black.svg"
  ) {
    return "asset_request";
  }
  return "public_page";
}

function safeReleaseShaPrefix(value: string | undefined): string {
  return value && /^[a-f0-9]{40}$/i.test(value)
    ? value.toLowerCase().slice(0, 12)
    : "unavailable";
}

function durationBucket(durationMs: number): string {
  if (durationMs < 25) return "lt_25ms";
  if (durationMs < 100) return "25_99ms";
  if (durationMs < 500) return "100_499ms";
  if (durationMs < 2_000) return "500_1999ms";
  return "gte_2000ms";
}

/**
 * Reduces a request to bounded operational metadata immediately. The returned
 * object contains no URL, pathname, query, headers, identity, or provider data.
 */
export function beginRequestObservation(
  method: string,
  pathname: string,
  releaseSha: string | undefined,
): RequestObservation {
  const routeClass = classifyRoute(pathname);
  return {
    requestId: crypto.randomUUID(),
    method,
    routeClass,
    releaseShaPrefix: safeReleaseShaPrefix(releaseSha),
    startedAt: Date.now(),
  };
}

export function correlatedResponse(
  response: Response,
  observation: RequestObservation | null,
): Response {
  if (!observation || response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("x-request-id", observation.requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Emits only the approved request-correlation fields for dynamic requests. */
export function observeResponse(
  observation: RequestObservation | null,
  response: Response,
): void {
  if (!observation) return;
  console.log(
    JSON.stringify({
      event: "worker_request",
      requestId: observation.requestId,
      releaseShaPrefix: observation.releaseShaPrefix,
      method: observation.method,
      routeClass: observation.routeClass,
      status: response.status,
      duration: durationBucket(Date.now() - observation.startedAt),
    }),
  );
}

export function observeScheduledFailure(releaseSha: string | undefined): void {
  console.error(
    JSON.stringify({
      event: "worker_scheduled_failure",
      releaseShaPrefix: safeReleaseShaPrefix(releaseSha),
    }),
  );
}
