import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";

const objects = ["watch", "read", "listen", "collect", "play", "move", "travel"];
const widths = [320, 390, 768, 1024, 1440, 1920];

test("collection screens preserve saved, empty, unavailable, and missing-artwork states", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 844 });
  for (const fixture of ["empty", "stale", "unavailable", "long-title", "missing-artwork"]) {
    for (const object of objects.filter((id) => id !== "travel")) {
      const response = await page.goto(`/play/${object}?fixture=${fixture}`, { waitUntil: "networkidle" });
      expect(response.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: `${object}: ${fixture}` }).toBeLessThanOrEqual(321);
      await expect(page.locator("iframe, canvas")).toHaveCount(0);
      if (fixture === "stale" && object !== "move") await expect(page.getByText("Saved snapshot", { exact: true })).toBeVisible();
      if (["empty", "unavailable"].includes(fixture)) await expect(page.locator("[data-tactile-item]")).toHaveCount(0);
    }
  }
});

for (const object of objects) {
  test(`${object}: hardware screen, responsive controls, and accessible content`, async ({ page }) => {
    test.setTimeout(90_000);
    const externalRequests = [];
    page.on("request", (request) => {
      if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) externalRequests.push(request.url());
    });
    await page.goto(`/play/${object}`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-match-cut-state]")).toHaveAttribute("data-match-cut-state", "settled");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Back to room", exact: true })).toBeVisible();
    const item = page.locator("[data-tactile-item]").first();
    if (await item.count()) {
      await item.locator("summary").click();
      await expect(item).toHaveAttribute("open", "");
      await expect(item.getByRole("link")).toBeVisible();
      await item.locator("summary").press("Escape");
      await expect(item).not.toHaveAttribute("open", "");
      await expect(item.locator("summary")).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`/play/${object}$`));
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: `${object} at ${width}px` }).toBeLessThanOrEqual(width + 1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const result = await new AxeBuilder({ page }).include("main").analyze();
    expect(result.violations, JSON.stringify(result.violations)).toEqual([]);
    expect(externalRequests).toEqual([]);
    await mkdir("outputs/object-screens", { recursive: true });
    await page.screenshot({ path: `outputs/object-screens/${object}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `outputs/object-screens/${object}-desktop.png`, fullPage: true });
  });
}

test("channel links and crate dividers filter actual saved items and preserve search", async ({ page }) => {
  await page.goto("/play/watch?q=Signal&sort=title", { waitUntil: "networkidle" });
  await page.getByRole("navigation", { name: "Collection filters" }).getByRole("link", { name: /^watching/ }).click();
  await expect(page).toHaveURL(/filter=watching/);
  await expect(page).toHaveURL(/q=Signal/);
  await expect(page.locator("[data-collection-gallery] > li")).toHaveCount(5);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("[data-collection-gallery] > li")).toHaveCount(5);
  await page.goto("/play/collect", { waitUntil: "networkidle" });
  await expect(page.locator("[data-record-crate] > li")).toHaveCount(12);
  await page.getByRole("navigation", { name: "Record formats" }).getByRole("link", { name: /^Vinyl/ }).click();
  await expect(page).toHaveURL(/format=vinyl/);
  await expect(page.locator("[data-record-crate] > li")).toHaveCount(3);
  await page.getByText("Filters and sort", { exact: true }).click();
  await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("year");
  await expect(page).toHaveURL(/format=vinyl/);
  await expect(page).toHaveURL(/sort=year/);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("link", { name: "1990s", exact: true }).click();
  await expect(page).toHaveURL(/decade=1990s/);
  await expect(page).toHaveURL(/format=vinyl/);
  await expect(page.locator("[data-record-crate]")).toBeVisible();
});

test("deck transport wraps, preserves needle alignment, and never starts playback", async ({ page }) => {
  await page.goto("/play/listen", { waitUntil: "networkidle" });
  const inspector = page.locator("[data-spotify-groove-needle]");
  await page.getByRole("button", { name: /Previous track/ }).click();
  await expect.poll(async () => Number((await inspector.getAttribute("transform")).match(/rotate\(([-.\d]+)/)[1])).toBe(330);
  await page.getByRole("button", { name: /Next track/ }).click();
  await expect.poll(async () => Number((await inspector.getAttribute("transform")).match(/rotate\(([-.\d]+)/)[1])).toBe(0);
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("all object screens retain no-JavaScript links, disclosures, and readable fallbacks", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  for (const object of objects) {
    await page.goto(`/play/${object}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const first = page.locator("[data-tactile-item]").first();
    if (await first.count()) {
      await first.locator("summary").click();
      await expect(first.getByRole("link")).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  }
  await page.goto("/play/collect");
  await page.getByRole("navigation", { name: "Record formats" }).getByRole("link", { name: /^Vinyl/ }).click();
  await expect(page).toHaveURL(/format=vinyl/);
  await expect(page.locator("[data-record-crate] > li")).toHaveCount(3);
  await context.close();
});

test("forced colors and reduced motion keep native object interactions", async ({ browser }) => {
  const context = await browser.newContext({ forcedColors: "active", reducedMotion: "reduce", viewport: { width: 320, height: 844 } });
  const page = await context.newPage();
  for (const object of objects) {
    await page.goto(`/play/${object}`, { waitUntil: "networkidle" });
    const first = page.locator("[data-tactile-item]").first();
    if (await first.count()) {
      await first.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(first).toHaveAttribute("open", "");
      await expect(first.getByRole("link")).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  }
  await context.close();
});
