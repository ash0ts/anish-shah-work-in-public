import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectRoomReady } from "./helpers/room-readiness.mjs";

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`gothic Room visual slice at ${width}px`, async ({ page }) => {
    await mkdir(".playwright/room-art", { recursive: true });
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    const requests = [];
    const errors = [];
    page.on("request", request => requests.push(new URL(request.url()).pathname));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/play");
    const room = await expectRoomReady(page, { context: `gothic room at ${width}` });
    await expect(room.locator("[data-room-blockout]")).toHaveCount(5);
    await expect(room.locator("[data-room-art-preview]")).toBeVisible();
    await expect(page.locator('a[href="/simulation"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(requests.filter(path => /\/api\/(?:connectors|connector-artwork|travel|simulation)/.test(path))).toEqual([]);
    expect(requests.filter(path => /(?:Simulation|Campaign|phaser|gemini).*\.js$/i.test(path))).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `.playwright/room-art/room-${width}.png`, fullPage: true });
    if (width === 1440 || width === 390) {
      await room.locator("[data-room-poster-stage]").screenshot({ path: `.playwright/room-art/stage-${width}.png` });
      const axe = await new AxeBuilder({ page }).include("[data-room-runtime]").analyze();
      expect(axe.violations).toEqual([]);
    }
  });
}

test("Simulation stays dormant in the Room preview", async ({ request }) => {
  expect((await request.get("/simulation")).status()).toBe(404);
  for (const route of ["/api/simulation/session", "/api/simulation/turn"]) {
    expect((await request.post(route, { data: {} })).status()).toBe(404);
  }
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/simulation");
});
