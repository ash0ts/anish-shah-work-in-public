import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { readBoundedJsonBody } = await tsImport(
  "../lib/server/request-security.ts",
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

test("the Worker verifies Access identity and strips forgeable forwarded identity", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const accessStart = worker.indexOf("if (accessMode)");
  const accessBlock = worker.slice(
    accessStart,
    worker.indexOf('headers.set("content-security-policy"', accessStart),
  );
  assert.match(worker, /crypto\.subtle\.verify/);
  assert.match(worker, /claims\.iss !== issuer/);
  assert.match(worker, /claims\.exp <= now/);
  assert.match(worker, /tokenAudiences\.some/);
  assert.match(accessBlock, /headers\.delete\(SITES_EMAIL_HEADER\)/);
  assert.match(accessBlock, /headers\.delete\(ACCESS_ASSERTION_HEADER\)/);
  assert.match(accessBlock, /headers\.set\(INTERNAL_EMAIL_HEADER/);
  assert(
    accessBlock.indexOf("headers.delete(SITES_EMAIL_HEADER)") <
      accessBlock.indexOf("headers.set(INTERNAL_EMAIL_HEADER"),
  );
  assert.match(worker, /isProtectedOwnerPath/);
  assert.match(worker, /RATE_LIMIT_SALT/);
  assert.match(worker, /headers\.delete\(INTERNAL_NONCE_HEADER\)/);
});

test("the Worker applies the required secure response policy", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  for (const policy of [
    "content-security-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "frame-ancestors 'none'",
    "https://strava-embeds.com",
    "https://www.strava.com",
    "private, no-store",
    "x-robots-tag",
  ]) {
    assert.match(worker, new RegExp(policy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(worker, /script-src[^\n]*unsafe-inline/);
});

test("the public promotion import is rate-limited before its body is read", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const promotionStart = worker.indexOf(
    'url.pathname === "/api/play-promotion/import"',
  );
  const bodyRead = worker.indexOf(
    "const bounded = await boundedApiWrite",
    promotionStart,
  );
  const promotionBlock = worker.slice(promotionStart, bodyRead);

  assert(promotionStart >= 0);
  assert(bodyRead > promotionStart);
  assert.match(promotionBlock, /appRequest\.method === "POST"/);
  assert.match(promotionBlock, /"promotion-import"/);
  assert.match(
    promotionBlock,
    /consumeBucket\(key, PROMOTION_IMPORT_RATE_LIMIT\)/,
  );
  assert.match(promotionBlock, /status,?\s*429|,\s*429,/);
  assert.match(promotionBlock, /retry-after/);
  assert.match(worker, /const PROMOTION_IMPORT_RATE_LIMIT = 6/);
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
  const prepare = await readFile(
    new URL("../scripts/prepare-cloudflare-release.mjs", import.meta.url),
    "utf8",
  );
  assert.match(prepare, /AUTH_MODE:\s*"cloudflare_access"/);
  assert.match(prepare, /CF_ACCESS_TEAM_DOMAIN/);
  assert.match(prepare, /CF_ACCESS_AUD/);
  assert.match(prepare, /migrations_dir:\s*"\.\.\/\.\.\/drizzle"/);
  assert.match(prepare, /config\.workers_dev\s*=\s*true/);
  assert.match(prepare, /config\.preview_urls\s*=\s*false/);
  assert.doesNotMatch(prepare, /CONNECTOR_ENCRYPTION_KEY\s*:/);
  assert.doesNotMatch(prepare, /RATE_LIMIT_SALT\s*:/);
});
