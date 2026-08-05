import { isProtectedOwnerPath } from "./access";
import type { AccessIdentity, WorkerEnv } from "./runtime-types";
import { privateJson } from "./security-headers";

const OAUTH_CALLBACK_PROVIDERS = new Map([
  ["/api/connectors/myanimelist/oauth/callback", "myanimelist"],
  ["/api/connectors/spotify/oauth/callback", "spotify"],
  ["/api/connectors/discogs/oauth/callback", "discogs"],
]);

const OWNER_RATE_LIMIT = 30;
const ARTWORK_RATE_LIMIT = 120;
const DISCOGS_PUBLIC_READ_RATE_LIMIT = 120;
const PROMOTION_IMPORT_RATE_LIMIT = 6;
const OAUTH_CALLBACK_RATE_LIMIT = 20;
const SIMULATION_API_RATE_LIMIT = 12;
const TRAVEL_MEDIA_RATE_LIMIT = 180;
const RATE_WINDOW_MS = 60_000;
const DISCOGS_PUBLIC_READ_PATH = "/api/connectors/discogs";
const SIMULATION_API_PREFIX = "/api/simulation/";

function isTravelMediaPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/travel-media/") ||
    /^\/api\/studio\/travel\/uploads\/[^/]+$/.test(pathname)
  );
}

const requestBuckets = new Map<
  string,
  { count: number; expiresAt: number }
>();

async function oneWayBucketKey(
  env: WorkerEnv,
  request: Request,
  namespace: string,
  identity?: string,
): Promise<string | null> {
  const salt = env.RATE_LIMIT_SALT?.trim();
  const requestUrl = new URL(request.url);
  const source =
    identity ??
    request.headers.get("cf-connecting-ip")?.trim() ??
    (env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1", "::1"].includes(requestUrl.hostname)
      ? "local-loopback"
      : undefined);
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

type RateLimitResult =
  | { status: "allowed" }
  | { status: "limited"; retryAfter: number }
  | { status: "setup_required" };

async function consumeRateLimit(
  binding: RateLimitBinding | undefined,
  key: string | null,
  localLimit: number,
  development: boolean,
): Promise<RateLimitResult> {
  if (!key) return { status: "setup_required" };
  if (binding) {
    try {
      const result = await binding.limit({ key });
      return result.success
        ? { status: "allowed" }
        : { status: "limited", retryAfter: 60 };
    } catch {
      return { status: "setup_required" };
    }
  }
  if (!development) return { status: "setup_required" };
  const retryAfter = consumeBucket(key, localLimit);
  return retryAfter
    ? { status: "limited", retryAfter }
    : { status: "allowed" };
}

function rateLimitResponse(
  result: RateLimitResult,
  message: string,
): Response | null {
  if (result.status === "allowed") return null;
  if (result.status === "setup_required") {
    return privateJson(
      "Request throttling is not configured.",
      "rate_limit_setup_required",
      503,
    );
  }
  const response = privateJson(message, "rate_limited", 429);
  response.headers.set("retry-after", String(result.retryAfter));
  return response;
}

export function requiresConfiguredRateLimit(
  env: WorkerEnv,
  pathname: string,
  directProduction: boolean,
  accessMode: boolean,
): boolean {
  const rateLimitSalt = env.RATE_LIMIT_SALT?.trim();
  const rateLimitSaltReady = Boolean(
    rateLimitSalt && rateLimitSalt.length >= 32,
  );
  const discogsPublicReadMissingConfig =
    pathname === DISCOGS_PUBLIC_READ_PATH &&
    (!rateLimitSaltReady || !env.ARTWORK_RATE_LIMITER);
  const simulationMissingConfig =
    env.SIMULATION_EXPERIENCE_MODE === "campaign-v1" &&
    pathname.startsWith(SIMULATION_API_PREFIX) &&
    (!rateLimitSaltReady || !env.SIMULATION_RATE_LIMITER);
  const travelMediaMissingConfig =
    isTravelMediaPath(pathname) &&
    (!rateLimitSaltReady || !env.TRAVEL_MEDIA_RATE_LIMITER);
  return Boolean(
    directProduction &&
      accessMode &&
      (discogsPublicReadMissingConfig ||
        simulationMissingConfig ||
        travelMediaMissingConfig ||
        (!rateLimitSaltReady &&
          (isProtectedOwnerPath(pathname) ||
            pathname.startsWith("/api/connector-artwork/") ||
            pathname === "/api/play-promotion/import" ||
            OAUTH_CALLBACK_PROVIDERS.has(pathname)))),
  );
}

export async function throttleSimulationApi(
  env: WorkerEnv,
  request: Request,
  development: boolean,
  pathname = new URL(request.url).pathname,
): Promise<Response | null> {
  if (
    env.SIMULATION_EXPERIENCE_MODE !== "campaign-v1" ||
    !pathname.startsWith(SIMULATION_API_PREFIX)
  ) {
    return null;
  }
  const key = await oneWayBucketKey(env, request, "simulation-api");
  return rateLimitResponse(
    await consumeRateLimit(
      env.SIMULATION_RATE_LIMITER,
      key,
      SIMULATION_API_RATE_LIMIT,
      development,
    ),
    "Simulation requests are temporarily limited.",
  );
}

export function rateLimitSetupResponse(): Response {
  return privateJson(
    "Request throttling is not configured.",
    "rate_limit_setup_required",
    503,
  );
}

export async function throttleOAuthCallback(
  env: WorkerEnv,
  request: Request,
  development: boolean,
  pathname = new URL(request.url).pathname,
): Promise<Response | null> {
  const provider = OAUTH_CALLBACK_PROVIDERS.get(pathname);
  if (request.method !== "GET" || !provider) return null;
  const key = await oneWayBucketKey(env, request, `${provider}-oauth-callback`);
  return rateLimitResponse(
    await consumeRateLimit(
      env.OAUTH_CALLBACK_RATE_LIMITER,
      key,
      OAUTH_CALLBACK_RATE_LIMIT,
      development,
    ),
    "Too many authorization callbacks. Try again shortly.",
  );
}

export async function throttlePromotionImport(
  env: WorkerEnv,
  request: Request,
  development: boolean,
  pathname = new URL(request.url).pathname,
): Promise<Response | null> {
  if (
    request.method !== "POST" ||
    pathname !== "/api/play-promotion/import"
  ) {
    return null;
  }
  const key = await oneWayBucketKey(env, request, "promotion-import");
  return rateLimitResponse(
    await consumeRateLimit(
      env.PROMOTION_RATE_LIMITER,
      key,
      PROMOTION_IMPORT_RATE_LIMIT,
      development,
    ),
    "Too many promotion attempts. Try again shortly.",
  );
}

export async function throttleOwnerWrite(
  env: WorkerEnv,
  request: Request,
  identity: AccessIdentity | null,
  development: boolean,
  pathname = new URL(request.url).pathname,
): Promise<Response | null> {
  if (
    !["POST", "PUT", "PATCH", "DELETE"].includes(request.method) ||
    !isProtectedOwnerPath(pathname) ||
    (!identity && !development)
  ) {
    return null;
  }
  const key = await oneWayBucketKey(
    env,
    request,
    "owner-write",
    identity?.email.toLocaleLowerCase(),
  );
  return rateLimitResponse(
    await consumeRateLimit(
      env.OWNER_RATE_LIMITER,
      key,
      OWNER_RATE_LIMIT,
      development,
    ),
    "Too many owner requests. Try again shortly.",
  );
}

export async function throttleArtwork(
  env: WorkerEnv,
  request: Request,
  development: boolean,
  pathname = new URL(request.url).pathname,
): Promise<Response | null> {
  if (!pathname.startsWith("/api/connector-artwork/")) return null;
  const key = await oneWayBucketKey(env, request, "artwork");
  return rateLimitResponse(
    await consumeRateLimit(
      env.ARTWORK_RATE_LIMITER,
      key,
      ARTWORK_RATE_LIMIT,
      development,
    ),
    "Artwork requests are temporarily limited.",
  );
}

export async function throttleTravelMedia(
  env: WorkerEnv,
  request: Request,
  development: boolean,
  pathname = new URL(request.url).pathname,
): Promise<Response | null> {
  if (!isTravelMediaPath(pathname)) return null;
  const key = await oneWayBucketKey(env, request, "travel-media");
  return rateLimitResponse(
    await consumeRateLimit(
      env.TRAVEL_MEDIA_RATE_LIMITER,
      key,
      TRAVEL_MEDIA_RATE_LIMIT,
      development,
    ),
    "Travel media requests are temporarily limited.",
  );
}

export async function throttleDiscogsPublicRead(
  env: WorkerEnv,
  request: Request,
  development: boolean,
  pathname = new URL(request.url).pathname,
): Promise<Response | null> {
  if (
    request.method !== "GET" ||
    pathname !== DISCOGS_PUBLIC_READ_PATH
  ) {
    return null;
  }
  const key = await oneWayBucketKey(env, request, "discogs-public-read");
  return rateLimitResponse(
    await consumeRateLimit(
      env.ARTWORK_RATE_LIMITER,
      key,
      DISCOGS_PUBLIC_READ_RATE_LIMIT,
      development,
    ),
    "Discogs collection requests are temporarily limited.",
  );
}
