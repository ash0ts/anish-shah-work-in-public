type RouteClass =
  | "oauth_callback"
  | "owner_api"
  | "owner_ui"
  | "public_api"
  | "public_page"
  | "static_asset";

function classifyRoute(pathname: string): RouteClass {
  if (pathname.includes("/oauth/callback")) return "oauth_callback";
  if (pathname === "/studio" || pathname.startsWith("/studio/")) {
    return "owner_ui";
  }
  if (pathname === "/api/studio" || pathname.startsWith("/api/studio/")) {
    return "owner_api";
  }
  if (pathname.startsWith("/api/")) return "public_api";
  if (pathname.startsWith("/_") || pathname.includes(".")) {
    return "static_asset";
  }
  return "public_page";
}

/**
 * Emits only bounded operational metadata. Never pass a URL, query string,
 * identity, token, OAuth code/state, provider payload, or request headers.
 */
export function observeResponse(request: Request, response: Response): void {
  if (response.status < 400) return;
  const pathname = new URL(request.url).pathname;
  console.warn(
    JSON.stringify({
      event: "worker_response",
      method: request.method,
      routeClass: classifyRoute(pathname),
      status: response.status,
    }),
  );
}

/**
 * Records that a Worker handler failed without serializing the thrown value.
 * Error objects can contain provider responses, request URLs, or OAuth query
 * material, so callers must never pass them into this boundary.
 */
export function observeHandlerFailure(
  method: string,
  pathname: string,
  handler: "fetch" | "scheduled",
): void {
  console.error(
    JSON.stringify({
      event: "worker_handler_failure",
      handler,
      method,
      routeClass: classifyRoute(pathname),
    }),
  );
}

export function observeScheduledFailure(): void {
  console.error(
    JSON.stringify({
      event: "worker_handler_failure",
      handler: "scheduled",
    }),
  );
}
