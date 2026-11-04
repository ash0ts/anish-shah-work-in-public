import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register("./content-connector-loader.mjs", import.meta.url);
const { evaluateStravaFraming } = await import("../lib/server/strava/framing.ts");
const { verifyStravaEmbed } = await import("../lib/server/strava/verification.ts");
const { normalizeStravaEmbed } = await import("../lib/server/strava/parser.ts");
const embed = "https://strava-embeds.com/activity/12345?fromEmbed=true&style=standard";
const origin = "https://anish-shah-is.online";

test("framing evaluates the real ancestor and enforced CSP takes precedence over XFO", () => {
  const cases = [
    [{ "x-frame-options": "DENY", "content-security-policy": "frame-ancestors " + origin }, true, "csp"],
    [{ "x-frame-options": "SAMEORIGIN", "content-security-policy": "frame-ancestors https:" }, true, "csp"],
    [{ "x-frame-options": "DENY", "content-security-policy-report-only": "frame-ancestors *" }, false, "x-frame-options"],
    [{ "content-security-policy": "frame-ancestors 'self' https://*.strava.com" }, false, "csp"],
    [{ "content-security-policy": "frame-ancestors " + origin + ".evil.test" }, false, "csp"],
    [{ "content-security-policy": "frame-ancestors " + origin + ":8443" }, false, "csp"],
    [{ "content-security-policy": "frame-ancestors 'none'; frame-ancestors *" }, false, "csp"],
    [{ "content-security-policy": "frame-ancestors *, frame-ancestors 'none'" }, false, "csp"],
    [{ "content-security-policy": "frame-ancestors " + origin + ", default-src 'none'" }, true, "csp"],
    [{ "content-security-policy": "default-src 'none'" }, true, "none"],
    [{ "content-security-policy": "frame-ancestors" }, false, "csp"],
    [{ "content-security-policy": "frame-ancestors 'none' " + origin }, true, "csp"],
  ];
  for (const [headers, permitted, policy] of cases) {
    assert.deepEqual(evaluateStravaFraming(new Headers(headers), embed, origin), { permitted, policy }, JSON.stringify(headers));
  }
  assert.equal(evaluateStravaFraming(new Headers({ "content-security-policy": "frame-ancestors https://*.example.test" }), embed, "https://a.example.test").permitted, true);
  assert.equal(evaluateStravaFraming(new Headers({ "content-security-policy": "frame-ancestors https://*.example.test" }), embed, "https://example.test").permitted, false);
});

test("verification diagnoses redirects and legacy embeds without claiming visual success", async () => {
  let calls = 0;
  const success = await verifyStravaEmbed(embed, async (url, options) => {
    calls++; assert.equal(options.redirect, "manual"); assert.equal(url, embed);
    return new Response("<html></html>", { headers: { "content-security-policy": "frame-ancestors " + origin } });
  }, origin);
  assert.equal(success.status, "available");
  assert.equal(success.diagnostic.result, "headers_permit");
  assert.equal(success.diagnostic.visuallyVerified, false);
  const redirected = await verifyStravaEmbed(embed, async () => new Response(null, { status: 302, headers: { location: "https://example.test/private?secret=do-not-store" } }), origin);
  assert.equal(redirected.reason, "redirected");
  assert.equal(JSON.stringify(redirected).includes("secret"), false);
  const legacy = "https://www.strava.com/activities/12345/embed/abc123";
  assert.match(normalizeStravaEmbed(legacy).message, /legacy/);
  const rejected = await verifyStravaEmbed(legacy, async () => { calls++; throw Error("must not fetch"); }, origin);
  assert.equal(rejected.reason, "legacy_format");
  const arbitrary = await verifyStravaEmbed("https://attacker.test/", async () => { calls++; throw Error("must not fetch"); }, origin);
  assert.equal(arbitrary.reason, "invalid_embed");
  assert.equal(calls, 1);
});
