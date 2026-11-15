import { test, expect } from "@playwright/test";

test("release smoke: public routes and protected owner routes", async ({ request }) => {
  for (const route of ["/", "/about", "/work", "/play?view=directory", "/sources", "/privacy"]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    expect(response.headers()["content-security-policy"], route).toBeTruthy();
    const body = await response.text();
    expect((body.match(/<h1(?:\s|>)/g) ?? []).length, route).toBe(1);
  }
  for (const route of ["/api/studio/health", "/api/studio/publication-checkpoint"]) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBeGreaterThanOrEqual(400);
  }
  const simulation = await request.get("/simulation");
  expect(simulation.status()).toBe(404);
});

test("release smoke: directory and Work are usable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const requests = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.goto("/play?view=directory");
    await expect(page.locator("canvas, iframe")).toHaveCount(0);
    for (const object of ["watch", "read", "listen", "collect", "play", "move", "travel"]) {
      await expect(page.locator(`a[href="/play/${object}"]`).first()).toBeVisible();
    }
    expect(requests.filter((url) => /^\/api\/(connectors|travel|simulation)/.test(url))).toEqual([]);
    await page.goto("/work");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("table").first()).toBeVisible();
  } finally { await context.close(); }
});
