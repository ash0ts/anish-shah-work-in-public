import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Miniflare, Log, LogLevel } from "miniflare";
import bundle from "../content/public/anish-content.public.v1.json" with { type: "json" };

const root = path.resolve(import.meta.dirname, "..");
const origin = "https://anish-shah-is.online";

function fixtureRow(hidden = false) {
  const records = [
    ...bundle.items.map((item) => ({ ...item, recordType: item.type })),
    ...bundle.workGroups.map((group) => ({ ...group, recordType: "work_group" })),
    ...bundle.metrics.filter((metric) => "displayValue" in metric).map((metric) => ({ ...metric, recordType: "metric", title: `${metric.displayValue} ${metric.label}`, summary: metric.qualifier })),
    ...bundle.narratives.map((narrative) => ({ ...narrative, recordType: "narrative", summary: narrative.body })),
  ].filter((record) => record.publicationState === "public" && (!hidden || record.slug !== "wandb-mcp-server")).map((record, index) => ({
    id: record.id, recordType: record.recordType, slug: record.slug ?? null,
    title: record.title, summary: record.summary ?? "", approvedPublicWording: "", caveat: "",
    featured: false, sortOrder: index, verificationState: record.verificationState ?? "verified",
    evidenceAccess: "public_web", publicPayload: {},
  }));
  const canonical = { schemaVersion: "1.1", baseContentVersion: bundle.contentVersion, records };
  const contentHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { contentHash, snapshotJson: JSON.stringify({ ...canonical, contentHash, publishedAt: "2026-11-15T00:00:00.000Z" }) };
}

test("the built Worker shares availability, metadata, and SSR publication work without cross-request reuse", { timeout: 30_000 }, async () => {
  const serverRoot = path.join(root, "dist/server");
  const modules = [{ type: "ESModule", path: path.join(root, "tests/fixtures/publication-observation-worker.mjs") }];
  for (const file of await readdir(serverRoot, { recursive: true })) {
    if (file.endsWith(".js") || file.endsWith(".mjs")) modules.push({ type: "ESModule", path: path.join(serverRoot, file) });
  }
  const fixture = fixtureRow();
  let outboundRequests = 0;
  const worker = new Miniflare({
    modulesRoot: root, modules, compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"],
    log: new Log(LogLevel.NONE),
    bindings: {
      NODE_ENV: "production", DEPLOYMENT_TIER: "production", PUBLIC_CONTENT_MODE: "d1_kv_required",
      SITE_URL: origin, PRODUCTION_SITE_URL: origin, RELEASE_VERSION: "2.6.1", RELEASE_SHA: "a".repeat(40),
      SIMULATION_EXPERIENCE_MODE: "disabled", SIMULATION_AI_MODE: "authored-only", TRAVEL_ATLAS_MODE: "disabled",
      RATE_LIMIT_SALT: "example-publication-fixture-rate-limit-salt",
      FIXTURES: { public: fixture, hidden: fixtureRow(true), invalid: { ...fixture, contentHash: "0".repeat(64) }, missing: "missing" },
    },
    outboundService: () => { outboundRequests += 1; return new Response("External requests prohibited", { status: 599 }); },
  });
  const request = (route, state = "public") => worker.dispatchFetch(origin + route, {
    headers: { "cf-connecting-ip": "203.0.113.4", "x-fixture-state": state },
  });
  try {
    const routes = ["/", "/about", "/work", "/work?bucket=products-open-source&topic=agent-systems&year=2026", "/work/wandb-mcp-server", "/sitemap.xml"];
    for (const route of routes) {
      const response = await request(route);
      assert.equal(response.status, 200, `${route}: ${await response.clone().text()}`);
      assert.equal(response.headers.get("x-fixture-publication-reads"), "1", route);
      assert.equal(response.headers.get("x-fixture-publication-validations"), "1", route);
    }
    const [visible, hidden] = await Promise.all([
      request("/sitemap.xml"),
      request("/sitemap.xml", "hidden"),
    ]);
    assert.equal(visible.status, 200);
    assert.equal(hidden.status, 200);
    assert.match(await visible.text(), /<loc>https:\/\/anish-shah-is.online\/work\/wandb-mcp-server<\/loc>/);
    assert.doesNotMatch(await hidden.text(), /<loc>https:\/\/anish-shah-is.online\/work\/wandb-mcp-server<\/loc>/);
    assert.equal(hidden.headers.get("x-fixture-publication-reads"), "1");
    for (const state of ["invalid", "missing"]) {
      const response = await request("/about", state);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("x-fixture-publication-reads"), "1");
    }
    const malformed = await request("/work?page=2x");
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get("x-fixture-publication-reads"), "0");
    for (const route of ["/_next/rsc", "/work", "/%5fnext/rsc"]) {
      const response = await worker.dispatchFetch(origin + route, {
        method: "POST",
        headers: { "next-action": "malformed", origin: "https://untrusted.example" },
        body: "x".repeat(100_000),
      });
      assert.equal(response.status, 400, route);
      assert.equal(await response.text(), "Bad Request", route);
      assert.equal(response.headers.get("x-fixture-publication-reads"), "0", route);
      assert.match(response.headers.get("cache-control"), /no-store/, route);
    }
    assert.equal(outboundRequests, 0);
  } finally { await worker.dispose(); }
});
