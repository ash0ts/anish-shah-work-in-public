// Manual vendor-compatibility probe, never a network-dependent PR gate.
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";

const scriptUrl = "https://static.cloudflareinsights.com/beacon.min.js";
const origin = "https://analytics-fixture.example";
const response = await fetch(scriptUrl, { signal: AbortSignal.timeout(10_000) });
if (!response.ok || response.url !== scriptUrl) throw new Error("Official beacon could not be retrieved directly");
const source = await response.text();
if (Buffer.byteLength(source) > 131_072) throw new Error("Beacon exceeds reviewed probe size budget");
const report = {
  checkedAt: new Date().toISOString(),
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  telemetrySent: false,
  cases: [],
};
const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of ["clean", "private-referrer", "late-query", "late-private", "late-callback"]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const payloads = [];
    // This intercept precedes navigation and handles every browser request.
    // The script is downloaded above; all browser responses are local fixtures.
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        payloads.push(request.postData() ?? "");
        return route.fulfill({ status: 204 });
      }
      if (request.url() === scriptUrl) return route.fulfill({ contentType: "application/javascript", body: source });
      if (request.url() === `${origin}/about`) return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><h1>Public fixture</h1><p>Synthetic privacy canaries only.</p><script src="${scriptUrl}" data-cf-beacon='{"token":"00000000000000000000000000000000","spa":false}'></script>`,
      });
      return route.abort();
    });
    await page.goto(`${origin}/about`, {
      referer: scenario === "private-referrer" ? `${origin}/studio?code=SYNTHETIC_SECRET` : undefined,
      waitUntil: "load",
    });
    await page.evaluate((scenario) => {
      const destination = {
        "late-query": "/work?q=SYNTHETIC_SEARCH",
        "late-private": "/studio?code=SYNTHETIC_SECRET",
        "late-callback": "/api/connectors/spotify/oauth/callback?code=SYNTHETIC_SECRET",
      }[scenario];
      if (destination) history.pushState({}, "", destination);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    }, scenario);
    // Observe a bounded vendor-event window, not a site-readiness delay.
    await page.waitForTimeout(600);
    const captured = payloads.join("\n");
    const privatePath = /\/studio|\/api\//.test(captured);
    const queryValue = /SYNTHETIC_SECRET|SYNTHETIC_SEARCH/.test(captured);
    const excludedQueryRoute = scenario === "late-query" && /\/work/.test(captured);
    report.cases.push({ scenario, requests: payloads.length, privatePath, queryValue, excludedQueryRoute,
      passes: payloads.length > 0 && !privatePath && !queryValue && !excludedQueryRoute });
    await context.close();
  }
} finally { await browser.close(); }
report.compatible = report.cases.every(({ passes }) => passes);
console.log(JSON.stringify(report, null, 2));
if (!report.compatible) process.exitCode = 2;
