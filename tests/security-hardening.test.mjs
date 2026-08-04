import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { readBoundedJsonBody } = await tsImport(
  "../lib/server/request-security.ts",
  import.meta.url,
);
const { authenticateRequest, isProtectedOwnerPath, isSitesRuntime } =
  await tsImport("../worker/access.ts", import.meta.url);
const {
  requiresConfiguredRateLimit,
  throttleArtwork,
  throttleDiscogsPublicRead,
  throttleOAuthCallback,
  throttleOwnerWrite,
} = await tsImport("../worker/rate-limiting.ts", import.meta.url);
const {
  beginRequestObservation,
  correlatedResponse,
  observeResponse,
  observeScheduledFailure,
} = await tsImport("../worker/redacted-observability.ts", import.meta.url);
const { productionOriginResponse } = await tsImport(
  "../worker/production-origin.ts",
  import.meta.url,
);
const { boundedApiWrite } = await tsImport(
  "../worker/request-limits.ts",
  import.meta.url,
);
const { canonicalSecurityPathname } = await tsImport(
  "../worker/request-path.ts",
  import.meta.url,
);
const { pruneConnectorRetention } = await tsImport(
  "../lib/server/connectors/repository-retention.ts",
  import.meta.url,
);
const { RELEASE_MARKER_HEADER, securedResponse } = await tsImport(
  "../worker/security-headers.ts",
  import.meta.url,
);

test("bounded JSON accepts valid input and rejects media-type and streaming bypasses", async () => {
  const valid = await readBoundedJsonBody(
    new Request("https://portfolio.example/api/studio/example", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ safe: true }),
    }),
    { maxBytes: 128 },
  );
  assert.deepEqual(valid, { ok: true, value: { safe: true } });

  const wrongType = await readBoundedJsonBody(
    new Request("https://portfolio.example/api/studio/example", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }),
  );
  assert.equal(wrongType.ok, false);
  assert.equal(wrongType.response.status, 415);

  const streamed = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":"'));
      controller.enqueue(new TextEncoder().encode("x".repeat(256)));
      controller.enqueue(new TextEncoder().encode('"}'));
      controller.close();
    },
  });
  const tooLarge = await readBoundedJsonBody(
    new Request("https://portfolio.example/api/studio/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: streamed,
      duplex: "half",
    }),
    { maxBytes: 64 },
  );
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.response.status, 413);
});

test("extracted Worker access and request guards preserve fail-closed behavior", async () => {
  const spoofed = new Request("http://localhost:3000/api/studio/example", {
    headers: {
      "cf-access-jwt-assertion": "spoofed",
      "oai-authenticated-user-email": "spoofed@example.com",
      "x-anish-authenticated-user-email": "spoofed@example.com",
      "x-anish-authenticated-auth-source": "spoofed",
      "x-anish-csp-nonce": "spoofed",
    },
  });
  const local = await authenticateRequest(spoofed, { NODE_ENV: "development" }, {
    pathname: "/api/studio/example",
    directProduction: false,
    sitesRuntime: false,
  });
  assert.equal(local.status, "allowed");
  for (const name of [
    "cf-access-jwt-assertion",
    "oai-authenticated-user-email",
    "x-anish-authenticated-user-email",
    "x-anish-authenticated-auth-source",
    "x-anish-csp-nonce",
  ]) {
    assert.equal(local.headers.get(name), null);
  }

  const production = await authenticateRequest(
    new Request("https://portfolio.example/studio"),
    { NODE_ENV: "production" },
    {
      pathname: "/studio",
      directProduction: true,
      sitesRuntime: false,
    },
  );
  assert.equal(production.status, "denied");
  assert.equal(production.response.status, 503);
  assert.equal(
    production.response.headers.get("cache-control"),
    "private, no-store",
  );

  const wrongType = await boundedApiWrite(
    new Request("https://portfolio.example/api/studio/example", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }),
    "/api/studio/example",
  );
  assert.equal(wrongType instanceof Response, true);
  assert.equal(wrongType.status, 415);
});

test("encoded route segments are canonicalized before Worker security decisions", async () => {
  const workerSource = await readFile(
    new URL("../worker/index.ts", import.meta.url),
    "utf8",
  );
  const canonicalization = workerSource.indexOf(
    "const pathname = canonicalSecurityPathname(url.pathname)",
  );
  const malformedRejection = workerSource.indexOf("if (pathname === null)");
  const originGuard = workerSource.indexOf("const originFailure");
  assert(canonicalization >= 0);
  assert(malformedRejection > canonicalization);
  assert(originGuard > malformedRejection);

  const encodedPublic = new Request(
    "https://anish-shah-is.online/api/connectors/%64iscogs?page=2",
    { headers: { "cf-connecting-ip": "203.0.113.51" } },
  );
  const publicPath = canonicalSecurityPathname(
    new URL(encodedPublic.url).pathname,
  );
  assert.equal(publicPath, "/api/connectors/discogs");

  const encodedCallback = new Request(
    "https://anish-shah-is.online/api/connectors/%64iscogs/oauth/%63allback?oauth_token=private",
    { headers: { "cf-connecting-ip": "203.0.113.52" } },
  );
  const callbackPath = canonicalSecurityPathname(
    new URL(encodedCallback.url).pathname,
  );
  assert.equal(callbackPath, "/api/connectors/discogs/oauth/callback");

  const encodedStudio = new Request(
    "https://anish-shah-is.online/api/%73tudio/connectors/discogs/refresh",
    { method: "POST" },
  );
  const studioPath = canonicalSecurityPathname(
    new URL(encodedStudio.url).pathname,
  );
  assert.equal(studioPath, "/api/studio/connectors/discogs/refresh");
  assert.equal(isProtectedOwnerPath(studioPath), true);

  const capturedKeys = [];
  const environment = {
    NODE_ENV: "production",
    RATE_LIMIT_SALT: "test-only-rate-limit-salt-value-1234567890",
    ARTWORK_RATE_LIMITER: {
      async limit({ key }) {
        capturedKeys.push(key);
        return { success: true };
      },
    },
    OAUTH_CALLBACK_RATE_LIMITER: {
      async limit({ key }) {
        capturedKeys.push(key);
        return { success: true };
      },
    },
    OWNER_RATE_LIMITER: {
      async limit({ key }) {
        capturedKeys.push(key);
        return { success: true };
      },
    },
  };
  assert.equal(
    await throttleDiscogsPublicRead(
      environment,
      encodedPublic,
      false,
      publicPath,
    ),
    null,
  );
  assert.equal(
    await throttleOAuthCallback(
      environment,
      encodedCallback,
      false,
      callbackPath,
    ),
    null,
  );
  assert.equal(
    await throttleOwnerWrite(
      environment,
      encodedStudio,
      { email: "owner@example.com" },
      false,
      studioPath,
    ),
    null,
  );
  assert.match(capturedKeys[0], /^discogs-public-read:/);
  assert.match(capturedKeys[1], /^discogs-oauth-callback:/);
  assert.match(capturedKeys[2], /^owner-write:/);

  assert.equal(
    canonicalSecurityPathname("/api/connectors/discogs/%"),
    null,
  );
  assert.equal(
    canonicalSecurityPathname("/api/connectors/discogs/%zz"),
    null,
  );
});

test("extracted Worker throttling and response hardening keep exact boundaries", async () => {
  const spotifyRequest = new Request(
    "http://localhost:3000/api/connectors/spotify/oauth/callback?code=private",
  );
  const myAnimeListRequest = new Request(
    "http://localhost:3000/api/connectors/myanimelist/oauth/callback?code=private",
  );
  const discogsRequest = new Request(
    "http://127.0.0.1:3000/api/connectors/discogs/oauth/callback?oauth_token=private",
  );
  const environment = {
    NODE_ENV: "development",
    RATE_LIMIT_SALT: "test-only-rate-limit-salt-value-1234567890",
  };
  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      await throttleOAuthCallback(environment, spotifyRequest, true),
      null,
    );
  }
  assert.equal(
    await throttleOAuthCallback(environment, myAnimeListRequest, true),
    null,
  );
  assert.equal(
    await throttleOAuthCallback(environment, discogsRequest, true),
    null,
  );
  const limited = await throttleOAuthCallback(environment, spotifyRequest, true);
  assert.equal(limited.status, 429);
  const retryAfter = Number(limited.headers.get("retry-after"));
  assert.equal(Number.isInteger(retryAfter), true);
  assert.equal(retryAfter >= 1 && retryAfter <= 60, true);

  const ownerWrite = new Request("http://localhost:3000/api/studio/publish", {
    method: "POST",
  });
  for (let index = 0; index < 30; index += 1) {
    assert.equal(
      await throttleOwnerWrite(environment, ownerWrite, null, true),
      null,
    );
  }
  assert.equal(
    (await throttleOwnerWrite(environment, ownerWrite, null, true))?.status,
    429,
  );

  const capturedKeys = [];
  const productionThrottle = {
    ...environment,
    NODE_ENV: "production",
    ARTWORK_RATE_LIMITER: {
      async limit({ key }) {
        capturedKeys.push(key);
        return { success: true };
      },
    },
  };
  const discogsRead = new Request(
    "https://anish-shah-is.online/api/connectors/discogs?page=2",
    { headers: { "cf-connecting-ip": "203.0.113.42" } },
  );
  assert.equal(
    await throttleDiscogsPublicRead(productionThrottle, discogsRead, false),
    null,
  );
  assert.equal(
    await throttleArtwork(
      productionThrottle,
      new Request(
        "https://anish-shah-is.online/api/connector-artwork/spotify/item",
        { headers: { "cf-connecting-ip": "203.0.113.42" } },
      ),
      false,
    ),
    null,
  );
  assert.match(capturedKeys[0], /^discogs-public-read:[a-f0-9]{32}$/);
  assert.match(capturedKeys[1], /^artwork:[a-f0-9]{32}$/);
  assert.notEqual(capturedKeys[0], capturedKeys[1]);
  assert.equal(capturedKeys.some((key) => key.includes("203.0.113.42")), false);

  const missingBinding = await throttleDiscogsPublicRead(
    environment,
    discogsRead,
    false,
  );
  assert.equal(missingBinding?.status, 503);
  assert.equal(
    requiresConfiguredRateLimit(
      environment,
      "/api/connectors/discogs",
      true,
      true,
    ),
    true,
  );
  assert.equal(
    requiresConfiguredRateLimit(
      productionThrottle,
      "/api/connectors/discogs",
      true,
      true,
    ),
    false,
  );

  const limitedDiscogsRead = await throttleDiscogsPublicRead(
    {
      ...productionThrottle,
      ARTWORK_RATE_LIMITER: {
        async limit() {
          return { success: false };
        },
      },
    },
    discogsRead,
    false,
  );
  assert.equal(limitedDiscogsRead?.status, 429);
  assert.equal(limitedDiscogsRead?.headers.get("retry-after"), "60");
  assert.equal(
    await throttleDiscogsPublicRead(
      productionThrottle,
      new Request("https://anish-shah-is.online/api/connectors/spotify"),
      false,
    ),
    null,
  );

  const secured = securedResponse(
    new Response("denied", { status: 401 }),
    new Request("https://portfolio.example/studio"),
    "A".repeat(24),
    false,
  );
  assert.equal(secured.headers.get("strict-transport-security"), "max-age=31536000");
  assert.equal(secured.headers.get("cache-control"), "private, no-store");
  assert.match(secured.headers.get("content-security-policy"), /strict-dynamic/);

  const previewRelease = "a".repeat(40);
  const preview = securedResponse(
    new Response(null, {
      headers: { [RELEASE_MARKER_HEADER]: "untrusted-upstream-value" },
    }),
    new Request("https://pr-26.anish-shah-is.online/play"),
    "B".repeat(24),
    false,
    "/play",
    "preview",
    previewRelease,
  );
  assert.equal(preview.headers.get(RELEASE_MARKER_HEADER), previewRelease);

  for (const [tier, value] of [
    ["preview", "A".repeat(40)],
    ["preview", "not-a-sha"],
    ["production", previewRelease],
  ]) {
    const response = securedResponse(
      new Response(null, {
        headers: { [RELEASE_MARKER_HEADER]: "untrusted-upstream-value" },
      }),
      new Request("https://anish-shah-is.online/play"),
      "C".repeat(24),
      false,
      "/play",
      tier,
      value,
    );
    assert.equal(response.headers.get(RELEASE_MARKER_HEADER), null);
  }
});

test("redacted Worker events correlate every dynamic response without request material", () => {
  const originalLog = console.log;
  const messages = [];
  console.log = (message) => messages.push(String(message));
  try {
    const observation = beginRequestObservation(
      "GET",
      "/api/connectors/spotify/oauth/callback",
      "a".repeat(40),
    );
    assert(observation);
    const correlated = correlatedResponse(
      new Response(null, { status: 401 }),
      observation,
    );
    assert.equal(correlated.headers.get("x-request-id"), observation.requestId);
    observeResponse(
      observation,
      correlated,
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(messages.length, 1);
  const event = JSON.parse(messages[0]);
  assert.deepEqual(Object.keys(event).sort(), [
    "duration",
    "event",
    "method",
    "releaseShaPrefix",
    "requestId",
    "routeClass",
    "status",
  ]);
  assert.equal(event.event, "worker_request");
  assert.match(event.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(event.releaseShaPrefix, "aaaaaaaaaaaa");
  assert.equal(event.method, "GET");
  assert.equal(event.routeClass, "oauth_callback");
  assert.equal(event.status, 401);
  assert.match(event.duration, /^(?:lt_25ms|25_99ms|100_499ms|500_1999ms|gte_2000ms)$/);
  assert.doesNotMatch(messages[0], /secret|private|code|state/i);

  for (const [pathname, expectedClass] of [
    ["/missing.json", "public_page"],
    ["/robots.txt", "public_page"],
    ["/sitemap.xml", "public_page"],
    ["/_vinext/image", "asset_request"],
    ["/_next/static/app.js", "asset_request"],
  ]) {
    const requestObservation = beginRequestObservation(
      "GET",
      pathname,
      "a".repeat(40),
    );
    assert.match(requestObservation.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(requestObservation.routeClass, expectedClass, pathname);
    const response = correlatedResponse(
      new Response(null, { status: pathname === "/missing.json" ? 404 : 200 }),
      requestObservation,
    );
    assert.equal(
      response.headers.get("x-request-id"),
      requestObservation.requestId,
      pathname,
    );
  }
});

test("scheduled Worker failure events expose only a release prefix", () => {
  const originalError = console.error;
  const messages = [];
  console.error = (message) => messages.push(String(message));
  try {
    observeScheduledFailure("b".repeat(40));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(messages, [
    '{"event":"worker_scheduled_failure","releaseShaPrefix":"bbbbbbbbbbbb"}',
  ]);
  assert.doesNotMatch(messages.join("\n"), /secret|private|token|code|state/i);
});

test("direct production accepts only the configured canonical apex", () => {
  const environment = {
    DEPLOYMENT_TIER: "production",
    SITE_URL: "https://anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "d1_kv_required",
    PLAY_EXPERIENCE_MODE: "my-room-2001",
  };
  const production = { development: false, sitesRuntime: false };
  assert.equal(
    productionOriginResponse(
      new Request("https://anish-shah-is.online/work"),
      environment,
      production,
    ),
    null,
  );

  for (const origin of [
    "https://www.anish-shah-is.online/work",
    "https://anish-shah-work-in-public.anish-shah-emails.workers.dev/work",
    "http://anish-shah-is.online/work",
  ]) {
    const response = productionOriginResponse(
      new Request(origin),
      environment,
      production,
    );
    assert.equal(response?.status, 421, origin);
    assert.equal(response?.headers.get("cache-control"), "private, no-store");
    assert.match(response?.headers.get("x-robots-tag") ?? "", /noindex/);
  }

  const misconfigured = productionOriginResponse(
    new Request("https://anish-shah-is.online/work"),
    { ...environment, SITE_URL: "https://wrong.example" },
    production,
  );
  assert.equal(misconfigured?.status, 503);
  assert.equal(misconfigured?.headers.get("retry-after"), "60");

  for (const playMode of [undefined, "", "unknown"]) {
    const playEnvironment = { ...environment };
    if (playMode === undefined) delete playEnvironment.PLAY_EXPERIENCE_MODE;
    else playEnvironment.PLAY_EXPERIENCE_MODE = playMode;
    const response = productionOriginResponse(
      new Request("https://anish-shah-is.online/play"),
      playEnvironment,
      production,
    );
    assert.equal(response?.status, 503, `hosted mode ${String(playMode)}`);
    assert.equal(response?.headers.get("cache-control"), "private, no-store");
    assert.match(response?.headers.get("x-robots-tag") ?? "", /noindex/);
  }

  assert.equal(
    productionOriginResponse(
      new Request("https://anish-shah-is.online/play"),
      { ...environment, PLAY_EXPERIENCE_MODE: "classic" },
      production,
    ),
    null,
  );

  assert.equal(
    productionOriginResponse(
      new Request("http://127.0.0.1:3000/work"),
      {},
      { development: true, sitesRuntime: false },
    ),
    null,
  );

  for (const loopbackOrigin of [
    "http://localhost:3000/work",
    "http://127.0.0.1:8788/work",
    "http://[::1]:3000/work",
  ]) {
    assert.equal(
      productionOriginResponse(new Request(loopbackOrigin), {}, {
        development: true,
        sitesRuntime: false,
      }),
      null,
      loopbackOrigin,
    );
  }

  const privateSitesOrigin =
    "https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site";
  assert.equal(isSitesRuntime(new URL(privateSitesOrigin).hostname), true);
  assert.equal(
    productionOriginResponse(
      new Request(`${privateSitesOrigin}/work`),
      { PLAY_EXPERIENCE_MODE: "classic" },
      { development: false, sitesRuntime: true },
    ),
    null,
  );

  for (const [requestUrl, options] of [
    [
      "http://portfolio.test/work",
      { development: true, sitesRuntime: false },
    ],
    [
      "http://127.0.0.2:3000/work",
      { development: true, sitesRuntime: false },
    ],
    [
      "https://reference.chatgpt.site/work",
      { development: false, sitesRuntime: true },
    ],
    [
      `${privateSitesOrigin}:444/work`,
      { development: false, sitesRuntime: true },
    ],
  ]) {
    const response = productionOriginResponse(
      new Request(requestUrl),
      environment,
      options,
    );
    assert.equal(response?.status, 421, requestUrl);
  }
  assert.equal(isSitesRuntime("reference.chatgpt.site"), false);
  assert.equal(isSitesRuntime("chatgpt.site"), false);
  assert.equal(
    isSitesRuntime(
      "anish-shah-work-in-public.coreweave-en-7694.chatgpt.site.example",
    ),
    false,
  );
});

test("the Worker verifies Access identity and strips forgeable forwarded identity", async () => {
  const [worker, access, accessVerifier] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/access.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../lib/server/cloudflare-access.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(accessVerifier, /createRemoteJWKSet/);
  assert.match(accessVerifier, /jwtVerify/);
  assert.match(accessVerifier, /issuer:\s*origin\.origin/);
  assert.match(accessVerifier, /audience:\s*\[\.\.\.audiences\]/);
  assert.match(accessVerifier, /payload\.email/);
  assert.doesNotMatch(accessVerifier, /console\./);
  assert.match(access, /if \(!options\.sitesRuntime\)[\s\S]*?headers\.delete\(SITES_EMAIL_HEADER\)/);
  assert.match(access, /headers\.delete\(ACCESS_ASSERTION_HEADER\)/);
  assert.match(access, /headers\.set\(INTERNAL_EMAIL_HEADER/);
  assert(
    access.indexOf("headers.delete(SITES_EMAIL_HEADER)") <
      access.indexOf("headers.set(INTERNAL_EMAIL_HEADER"),
  );
  assert.match(access, /isProtectedOwnerPath/);
  assert.match(
    access,
    /options\.directProduction[\s\S]{0,100}identityRequired[\s\S]{0,100}!accessMode/,
  );
  assert.match(worker, /authenticateRequest/);
  assert.match(worker, /requiresConfiguredRateLimit/);
  assert.match(access, /headers\.delete\(INTERNAL_NONCE_HEADER\)/);
});

test("the Worker applies the required secure response policy", async () => {
  const [worker, headers] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/security-headers.ts", import.meta.url), "utf8"),
  ]);
  for (const policy of [
    "content-security-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "frame-ancestors 'none'",
    "https://open.spotify.com",
    "https://strava-embeds.com",
    "https://www.strava.com",
    "private, no-store",
    "x-robots-tag",
  ]) {
    assert.match(headers, new RegExp(policy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(headers, /script-src[^\n]*unsafe-inline/);
  assert.match(
    headers,
    /isPlayPath\(pathname\)[\s\S]{0,500}private, no-store/,
  );
  assert.match(worker, /securedResponse/);
  assert.match(worker, /withRequestSecurityHeaders/);
});

test("provider OAuth callbacks are one-way throttled before application routing", async () => {
  const [worker, rateLimit] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/rate-limiting.ts", import.meta.url), "utf8"),
  ]);
  const callbackStart = worker.indexOf(
    "const oauthCallbackLimited = await throttleOAuthCallback",
  );
  const applicationRoute = worker.indexOf(
    "routeApplicationRequest(appRequest",
    callbackStart,
  );

  assert(callbackStart >= 0);
  assert(applicationRoute > callbackStart);
  assert.match(rateLimit, /oneWayBucketKey/);
  assert.match(rateLimit, /myanimelist\/oauth\/callback/);
  assert.match(rateLimit, /spotify\/oauth\/callback/);
  assert.match(rateLimit, /\$\{provider\}-oauth-callback/);
  assert.match(rateLimit, /env\.OAUTH_CALLBACK_RATE_LIMITER/);
  assert.match(rateLimit, /consumeRateLimit\(/);
  assert.match(rateLimit, /function rateLimitResponse/);
  assert.match(rateLimit, /"retry-after"/);
});

test("anonymous Discogs reads are one-way throttled before publication storage is read", async () => {
  const [worker, rateLimit] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/rate-limiting.ts", import.meta.url), "utf8"),
  ]);
  const throttleStart = worker.indexOf(
    "const discogsReadLimited = await throttleDiscogsPublicRead",
  );
  const publicationRead = worker.indexOf(
    "const unavailable = await publicationAvailabilityResponse",
  );
  const applicationRoute = worker.indexOf("routeApplicationRequest(appRequest");

  assert(throttleStart >= 0);
  assert(publicationRead > throttleStart);
  assert(applicationRoute > publicationRead);
  assert.match(rateLimit, /request\.method !== "GET"/);
  assert.match(rateLimit, /"discogs-public-read"/);
  assert.match(rateLimit, /env\.ARTWORK_RATE_LIMITER/);
  assert.match(rateLimit, /const DISCOGS_PUBLIC_READ_RATE_LIMIT = 120/);
  assert.match(rateLimit, /Discogs collection requests are temporarily limited/);
});

test("retention cleanup has an hourly scheduled Worker trigger", async () => {
  const [worker, retentionRepository, release] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../lib/server/connectors/repository-retention.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../scripts/prepare-cloudflare-release.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(
    retentionRepository,
    /export async function pruneConnectorRetention/,
  );
  assert.match(retentionRepository, /UPDATE play_promotion_transactions/);
  assert.match(retentionRepository, /ciphertext = NULL, iv = NULL/);
  assert.match(retentionRepository, /DELETE FROM play_promotion_transactions/);
  assert.match(retentionRepository, /deletedPromotionTransactions/);
  assert.match(worker, /async scheduled\(/);
  assert.match(worker, /pruneConnectorRetention\(/);
  assert.match(release, /config\.triggers = \{ crons: \["17 \* \* \* \*"\] \}/);
});

test("hourly retention clears expired promotion ciphertext and deletes old handoffs", async () => {
  const statements = [];
  const database = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          return { success: true };
        },
      };
      statements.push(statement);
      return statement;
    },
    async batch(batchStatements) {
      assert.equal(batchStatements.length, 6);
      return batchStatements.map((_, index) => ({ meta: { changes: index + 1 } }));
    },
  };
  const now = new Date("2026-08-03T12:00:00.000Z");
  await pruneConnectorRetention(database, now);

  const clear = statements.find((statement) =>
    statement.sql.includes("UPDATE play_promotion_transactions"),
  );
  const remove = statements.find((statement) =>
    statement.sql.includes("DELETE FROM play_promotion_transactions"),
  );
  assert(clear);
  assert(remove);
  assert.match(clear.sql, /ciphertext = NULL, iv = NULL/);
  assert.deepEqual(clear.values, [now.toISOString(), now.toISOString()]);
  assert.equal(remove.values.length, 1);
  assert(Date.parse(remove.values[0]) < now.getTime());

  const heartbeat = statements.find((statement) =>
    statement.sql.includes("INSERT INTO maintenance_state"),
  );
  assert(heartbeat);
  const details = JSON.parse(heartbeat.values[2]);
  assert.equal(details.clearedExpiredPromotionPayloads, 5);
  assert.equal(details.deletedPromotionTransactions, 6);
});

test("the public promotion import is rate-limited before its body is read", async () => {
  const [worker, rateLimit] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/rate-limiting.ts", import.meta.url), "utf8"),
  ]);
  const promotionStart = worker.indexOf(
    "const promotionLimited = await throttlePromotionImport",
  );
  const bodyRead = worker.indexOf(
    "const bounded = await boundedApiWrite",
    promotionStart,
  );
  const promotionBlock = worker.slice(promotionStart, bodyRead);

  assert(promotionStart >= 0);
  assert(bodyRead > promotionStart);
  assert.match(promotionBlock, /throttlePromotionImport/);
  assert.match(rateLimit, /request\.method !== "POST"/);
  assert.match(rateLimit, /"promotion-import"/);
  assert.match(rateLimit, /env\.PROMOTION_RATE_LIMITER/);
  assert.match(rateLimit, /consumeRateLimit\(/);
  assert.match(rateLimit, /privateJson\(message, "rate_limited", 429\)/);
  assert.match(rateLimit, /"retry-after"/);
  assert.match(rateLimit, /const PROMOTION_IMPORT_RATE_LIMIT = 6/);
});

test("structured data receives only the Worker-generated CSP nonce", async () => {
  const [home, work, helper] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/work/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/csp.ts", import.meta.url), "utf8"),
  ]);
  assert.match(home, /nonce=\{nonce\}/);
  assert.match(work, /nonce=\{nonce\}/);
  assert.match(helper, /\^\[A-Za-z0-9\+\/\]\{24\}\$/);
});

test("owner connector mutations have canonical Studio paths and legacy 308s", async () => {
  const [credentials, refresh, oauth, strava] = await Promise.all([
    readFile(new URL("../app/api/connectors/[provider]/credentials/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/[provider]/refresh/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/myanimelist/oauth/start/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/studio/connectors/strava/config/route.ts", import.meta.url), "utf8"),
  ]);
  for (const legacy of [credentials, refresh, oauth]) {
    assert.match(legacy, /status:\s*308/);
    assert.match(legacy, /\/api\/studio\/connectors/);
  }
  assert.match(strava, /export async function PUT/);
  assert.match(strava, /export async function DELETE/);
});

test("public Cloudflare release config is generated without embedding secrets", async () => {
  const [prepare, preflight, configContract] = await Promise.all([
    readFile(
      new URL("../scripts/prepare-cloudflare-release.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/release-preflight.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/lib/release-config-contract.mjs", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(prepare, /AUTH_MODE:\s*"cloudflare_access"/);
  assert.match(prepare, /CF_ACCESS_TEAM_DOMAIN/);
  assert.match(prepare, /CF_ACCESS_AUD/);
  assert.match(prepare, /migrations_dir:\s*"\.\.\/\.\.\/drizzle"/);
  assert.match(prepare, /CLOUDFLARE_PUBLICATION_CACHE_ID/);
  assert.match(prepare, /binding:\s*"PUBLICATION_CACHE"/);
  for (const binding of [
    "OWNER_RATE_LIMITER",
    "ARTWORK_RATE_LIMITER",
    "PROMOTION_RATE_LIMITER",
    "OAUTH_CALLBACK_RATE_LIMITER",
    "SIMULATION_RATE_LIMITER",
  ]) {
    assert.match(prepare, new RegExp(`name:\\s*"${binding}"`));
  }
  assert.match(prepare, /invocation_logs:\s*false/);
  assert.match(prepare, /RELEASE_SHA:\s*releaseSha/);
  assert.match(prepare, /CONTENT_VERSION:\s*publicBundle\.contentVersion/);
  assert.match(prepare, /PUBLIC_CONTENT_MODE:\s*"d1_kv_required"/);
  assert.match(prepare, /config\.account_id\s*=\s*PUBLIC_CLOUDFLARE_ACCOUNT_ID/);
  assert.match(prepare, /config\.workers_dev\s*=\s*false/);
  assert.match(prepare, /config\.preview_urls\s*=\s*false/);
  assert.match(prepare, /custom_domain:\s*true/);
  assert.match(prepare, /new URL\(PUBLIC_SITE_ORIGIN\)\.hostname/);
  assert.match(prepare, /head_sampling_rate:\s*1/);
  assert.doesNotMatch(prepare, /CONNECTOR_ENCRYPTION_KEY\s*:/);
  assert.doesNotMatch(prepare, /RATE_LIMIT_SALT\s*:/);
  assert.match(preflight, /assertPublicReleaseConfig/);
  assert.match(prepare, /assertPinnedProductionResources/);
  assert.match(configContract, /PUBLICATION_CACHE/);
  assert.match(configContract, /RATE_LIMITS/);
  assert.match(configContract, /invocation_logs !== false/);
  assert.match(configContract, /account_id !== expected\.accountId/);
  assert.match(configContract, /workers_dev !== false/);
  assert.match(configContract, /pattern:\s*"anish-shah-is\.online"/);
  assert.match(configContract, /custom_domain:\s*true/);
  assert.match(configContract, /head_sampling_rate !== 1/);
  assert.match(configContract, /AUTH_MODE: "cloudflare_access"/);
  assert.match(configContract, /NODE_ENV: "production"/);
});

test("release workflows bind PR evidence to the exact source head", async () => {
  const [ci, ...releaseWorkflows] = await Promise.all(
    ["ci.yml", "gitleaks.yml", "codeql.yml"].map((name) =>
      readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"),
    ),
  );
  assert.match(ci, /github\.event\.pull_request\.head\.sha/);
  assert.match(ci, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_SHA"/);
  assert.match(ci, /\[\[ "\$EXPECTED_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(ci, /PREVIEW_SOURCE_SHA/);
  assert.match(ci, /PREVIEW_WORKFLOW_SHA/);
  for (const workflow of releaseWorkflows) {
    assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
    assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_SHA"/);
    assert.match(workflow, /\[\[ "\$EXPECTED_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
    assert.match(workflow, /test "\$\{#GITHUB_SHA\}" -eq 40/);
    assert.doesNotMatch(workflow, /test "\$EXPECTED_SHA" = "\$GITHUB_SHA"/);
  }
});

test("owner-dispatched exact-SHA checks may use only the temporary release runner", async () => {
  const workflowNames = [
    "ci.yml",
    "gitleaks.yml",
    "codeql.yml",
    "browser-quality.yml",
    "browser-stability.yml",
  ];
  const workflows = await Promise.all(
    workflowNames.map((name) =>
      readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"),
    ),
  );
  const runnerExpression =
    "github.event_name == 'workflow_dispatch' && github.actor == github.repository_owner && inputs.runner_label == 'anish-release' && 'anish-release' || 'ubuntu-latest'";

  for (const [index, workflow] of workflows.entries()) {
    assert.match(workflow, /runner_label:\n\s+description:/, workflowNames[index]);
    assert.match(workflow, /default: github-hosted/, workflowNames[index]);
    assert.match(
      workflow,
      /options:\n\s+- github-hosted\n\s+- anish-release/,
      workflowNames[index],
    );
    assert.match(
      workflow,
      /test "\$GITHUB_ACTOR" = "\$GITHUB_REPOSITORY_OWNER"/,
      workflowNames[index],
    );
    assert.match(
      workflow,
      /\[\[ "\$REQUESTED_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/,
      workflowNames[index],
    );
    const runTargets = [...workflow.matchAll(/^\s+runs-on:\s+(.+)$/gm)].map(
      (match) => match[1],
    );
    assert.ok(runTargets.length > 0, workflowNames[index]);
    assert.ok(
      runTargets.every((target) => target.includes(runnerExpression)),
      `${workflowNames[index]} must keep automatic work hosted`,
    );
    assert.doesNotMatch(workflow, /^\s+environment:/m, workflowNames[index]);
    assert.doesNotMatch(workflow, /secrets:\s+inherit/, workflowNames[index]);
    const nonEphemeralSecrets = [
      ...workflow.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g),
    ]
      .map((match) => match[1])
      .filter((name) => name !== "GITHUB_TOKEN");
    assert.deepEqual(nonEphemeralSecrets, [], workflowNames[index]);
  }

  assert.match(workflows[0], /push:\n\s+branches: \[main\]/);
  assert.doesNotMatch(workflows[0], /codex\/\*\*/);
});

test("release promotion requires a protected current-publication marker", async () => {
  const [command, contract, snippet, plan] = await Promise.all([
    readFile(new URL("../scripts/release-command.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lib/release-contract.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/publication-bootstrap-snippet.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../scripts/write-release-plan.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(command, /remoteReleaseMarker/);
  assert.match(command, /assertReleaseMarker\(remoteReleaseMarker\(\)/);
  assert.match(contract, /release\.publication_ready/);
  assert.match(snippet, /\/api\/studio\/release-checkpoint/);
  assert.match(snippet, /bootstrapRequired \?/);
  assert.match(snippet, /typeof body\.code === "string"/);
  assert.match(snippet, /\^\[a-z0-9_\]\{1,64\}\$/);
  assert.doesNotMatch(snippet, /body\.error/);
  for (const variable of [
    "RELEASE_VALIDATION_URL",
    "RELEASE_GITLEAKS_URL",
    "RELEASE_CODEQL_URL",
    "RELEASE_BROWSER_URL",
  ]) {
    assert.match(plan, new RegExp(variable));
  }
  assert.match(plan, /event,workflowDatabaseId/);
  assert.match(plan, /actions\/workflows\/\$\{evidence\.workflowDatabaseId\}/);
  assert.match(plan, /assertActiveActionsWorkflow/);
  assert.match(plan, /workflowIdentity/);
  assert.match(contract, /workflowState: "active"/);
  for (const workflowPath of [
    ".github/workflows/ci.yml",
    ".github/workflows/gitleaks.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/browser-quality.yml",
  ]) {
    assert.match(contract, new RegExp(workflowPath.replaceAll(".", "\\.")));
  }
});

test("publication failover and maintenance health fail closed", async () => {
  const [content, editorial, health, checkpoint, migration, worker, publication] = await Promise.all([
    readFile(new URL("../lib/server/public-content.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/editorial.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/studio/health/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/studio/publication-checkpoint/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../drizzle/0005_steady_publication_guard.sql", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/publication-fallback.ts", import.meta.url), "utf8"),
  ]);
  assert.match(content, /PUBLICATION_FALLBACK_KEY/);
  assert.match(content, /resolveVerifiedPublicContentFromSnapshotRow/);
  assert.match(content, /throw new PublicContentUnavailableError/);
  assert.match(editorial, /publicationVersionKey/);
  assert.match(editorial, /publicationFallbackPointer/);
  assert.match(editorial, /fallbackStore\.put\(\s*fallbackVersionKey/);
  assert.match(
    editorial,
    /fallbackStore\.put\(\s*PUBLICATION_FALLBACK_KEY/,
  );
  assert.doesNotMatch(
    editorial,
    /fallbackStore\.delete\(PUBLICATION_FALLBACK_KEY\)/,
  );
  assert.match(worker, /publicationAvailabilityResponse/);
  assert.match(publication, /publicContentUnavailableResponse/);
  assert.match(publication, /status:\s*503/);
  assert.match(health, /authorizeOwnerApi/);
  assert.match(health, /private, no-store/);
  assert.match(checkpoint, /authorizeOwnerApi/);
  assert.match(checkpoint, /private, no-store/);
  assert.match(checkpoint, /getPublicationCheckpoint/);
  assert.match(migration, /CREATE TABLE `maintenance_state`/);
  const maintenance = await readFile(
    new URL("../lib/server/maintenance.ts", import.meta.url),
    "utf8",
  );
  assert.match(maintenance, /canonicalOrigin\.status === "setup_required"/);
  assert.match(maintenance, /expected:\s*PUBLIC_SITE_ORIGIN/);
  assert.match(
    maintenance,
    /CONNECTOR_PROVIDERS\s*=\s*\[[\s\S]*?"discogs"[\s\S]*?\]\s*as const/,
  );
  assert.match(maintenance, /expectedHostedOrigin/);
  assert.match(maintenance, /hostedEnvironmentConfigured/);
});

test("custom Worker observability never records raw request identifiers", async () => {
  const [worker, observability] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../worker/redacted-observability.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(worker, /beginRequestObservation\(/);
  assert.match(worker, /correlatedResponse\(/);
  assert.match(observability, /headers\.set\("x-request-id", observation\.requestId\)/);
  assert.match(worker, /observeResponse\(observation, secured\)/);
  assert.match(worker, /observeScheduledFailure\(env\.RELEASE_SHA\)/);
  assert.match(observability, /const routeClass = classifyRoute\(pathname\)/);
  const eventFields = observability.slice(observability.indexOf("JSON.stringify"));
  assert.doesNotMatch(eventFields, /request\.url/);
  assert.doesNotMatch(observability, /\.search(?:Params)?/);
  assert.doesNotMatch(observability, /headers\.get/);
  assert.doesNotMatch(
    observability,
    /(?:url|query|email|token|code|state)\s*:/i,
  );
});

test("dependency audit treats missing or malformed audit metadata as failure", async () => {
  const source = await readFile(
    new URL("../scripts/check-dependency-audit.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /auditReportVersion/);
  assert.match(source, /registry-error report/);
  assert.match(source, /result\.status !== 0 && result\.status !== 1/);
  assert.doesNotMatch(source, /result\.stdout \|\| "\{\}"/);
});

test("release evidence binds a pushed commit, migrations, and exact smoke checks", async () => {
  const [plan, attestation, command, checkpointSnippet, contract, triggerContract, packageJson] =
    await Promise.all([
      readFile(
        new URL("../scripts/write-release-plan.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/write-release-attestation.mjs", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../scripts/release-command.mjs", import.meta.url), "utf8"),
      readFile(
        new URL("../scripts/publication-bootstrap-snippet.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/lib/release-contract.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/lib/release-trigger-contract.mjs", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);
  assert.match(plan, /git\("rev-parse", "@\{upstream\}"\)/);
  assert.match(plan, /HEAD must be pushed to its configured upstream/);
  assert.match(plan, /scripts\/release-preflight\.mjs/);
  assert.match(plan, /publicContentSha256/);
  assert.match(plan, /preMigrationBookmark/);
  assert.match(plan, /migrations: migrationList\.map/);
  assert.match(plan, /sha256: sha256\(migrationBytes\[index\]\)/);
  assert.match(attestation, /REQUIRED_SMOKE_TESTS/);
  for (const check of [
    "public_routes",
    "studio_access",
    "non_owner_denial",
    "connector_galleries",
    "oauth_callbacks",
    "security_headers",
    "owner_health",
    "simulation_experience",
  ]) {
    assert.match(attestation, new RegExp(`"${check}"`));
  }
  for (const check of [
    "canonical_apex",
    "www_redirect",
    "workers_dev_disabled",
    "preview_urls_disabled",
    "request_id_header",
    "access_destinations",
  ]) {
    assert.match(triggerContract, new RegExp(`"${check}"`));
  }
  assert.match(attestation, /A migration changed after the pre-release plan/);
  assert.match(attestation, /releasePlanSha256/);
  assert.match(attestation, /readVerifiedDeployableArtifactManifest/);
  assert.match(attestation, /deployableArtifacts/);
  assert.match(plan, /verifyReleaseBuildCheckpoint\(root\)/);
  assert.match(plan, /releaseBuildCheckpointSha256/);
  assert.match(command, /verifyReleaseBuildCheckpoint\(root\)/);
  assert.match(command, /releaseBuildCheckpointSha256/);
  assert.match(checkpointSnippet, /verifyReleaseBuildCheckpoint\(root\)/);
  assert.match(checkpointSnippet, /releaseBuildCheckpoint\.artifactSetSha256/);
  assert.match(attestation, /verifyReleaseBuildCheckpoint\(root\)/);
  assert.match(attestation, /releaseBuildCheckpoint: plan\.releaseBuildCheckpoint/);
  assert.match(command, /assertRequiredValidationRuns\(plan\.validationRuns/);
  assert.match(attestation, /assertRequiredValidationRuns\(plan\.validationRuns/);
  assert.match(attestation, /validationRuns: plan\.validationRuns/);
  assert.match(contract, /Remote pending migrations/);
  assert.match(contract, /do not exactly match the release plan/);
  assert.match(command, /Migration \$\{migration\.name\} changed after release planning/);
  assert.match(command, /RELEASE_WORKER_VERSION/);
  assert.match(command, /"triggers", "deploy", "--config", configPath/);
  assert.match(command, /requireCurrentTriggerReceipt/);
  assert.match(attestation, /triggerDeploymentReceiptSha256/);
  assert.match(attestation, /domainCutover/);
  assert.match(attestation, /simulation/);
  assert.match(plan, /RELEASE_SIMULATION_APPROVED_PROVIDERS/);
  assert.match(plan, /RELEASE_SIMULATION_APPROVAL_DIGEST/);
  assert.match(contract, /sanitized approval-state digest/);
  assert.match(attestation, /permanent_path_query_preserving/);
  assert.match(attestation, /x-request-id/);
  assert.match(command, /readVerifiedDeployableArtifactManifest/);
  assert.match(plan, /deployableArtifactManifestSha256/);
  assert.doesNotMatch(packageJson, /wrangler d1 migrations apply/);
  assert.doesNotMatch(packageJson, /"cloudflare:deploy"\s*:\s*"wrangler deploy/);
  assert.match(packageJson, /"cloudflare:triggers"\s*:/);
  assert.match(packageJson, /deployable:attest:write/);
  assert.match(packageJson, /cloudflare:prepare[^\n]*bundle:scan/);
});

test("production source contains no retired Sites origin", async () => {
  const sources = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/robots.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/ConnectorControls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/connectors/ApiConnectorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/connectors/helpers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/connectors/MyAnimeListConnectorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/connectors/HardcoverConnectorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/connectors/SpotifyConnectorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/connectors/DiscogsConnectorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/connectors/SteamConnectorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/connectors/StravaConnectorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/seo.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/site-constants.ts", import.meta.url), "utf8"),
  ]);
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /chatgpt\.site/i);
  assert.match(
    combined,
    /https:\/\/anish-shah-is\.online/,
  );
  assert.doesNotMatch(
    combined,
    /https:\/\/anish-shah-work-in-public\.anish-shah-emails\.workers\.dev/,
  );
});
