import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";

import { objectFixtures } from "./helpers/object-fixtures.mjs";
import { installOverflowSampler, overflowReport, settlePaint } from "./helpers/overflow.mjs";
const objects = objectFixtures.map(({ id }) => id);
const widths = [320, 390, 768, 1024, 1440, 1920];

// Give each source/state its own context and normal test deadline. Thirty
// navigations must not compete for one shared timeout on slower CI machines.
for (const fixture of ["empty", "stale", "unavailable", "long-title", "missing-artwork"]) {
  for (const object of objects.filter((id) => id !== "travel")) {
    test(`${object}: ${fixture} collection remains readable and isolated`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 844 });
      const response = await page.goto(`/play/${object}?fixture=${fixture}`, { waitUntil: "networkidle" });
      expect(response.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: `${object}: ${fixture}` }).toBeLessThanOrEqual(321);
      await expect(page.locator("iframe, canvas")).toHaveCount(0);
      if (fixture === "stale" && object !== "move") await expect(page.getByText("Saved snapshot", { exact: true })).toBeVisible();
      if (["empty", "unavailable"].includes(fixture)) await expect(page.locator("[data-tactile-item]")).toHaveCount(0);
    });
  }
}

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
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations, JSON.stringify(result.violations)).toEqual([]);
    expect(externalRequests).toEqual([]);
    if (process.env.ROOM_CAPTURE_VISUALS === "1") {
    await mkdir("outputs/object-screens", { recursive: true });
    await page.screenshot({ path: `outputs/object-screens/${object}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `outputs/object-screens/${object}-desktop.png`, fullPage: true });
    }
    await installOverflowSampler(page);
    const route = `/play/${object}?fixture=long-title${object === "collect" ? "&view=gallery" : ""}`;
    await page.setViewportSize({ width: 320, height: 844 });
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", { name: objectFixtures.find(({ id }) => id === object).title })).toBeVisible();
    await settlePaint(page);
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await settlePaint(page);
      const overflow = await overflowReport(page);
      expect(overflow.offenders, JSON.stringify(overflow.offenders)).toEqual([]);
      expect(overflow.documentWidth).toBeLessThanOrEqual(width + 1);
      expect(overflow.maximumDocumentWidth).toBeLessThanOrEqual(width + 1);
    }
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

test.describe("no-JavaScript object screens", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  for (const object of objects) {
    test(`${object}: links, disclosures, and readable fallbacks`, async ({ page }) => {
      const response = await page.goto(`/play/${object}`);
      expect(response.status()).toBe(200);
      const fixture = objectFixtures.find(({ id }) => id === object);
      await expect(page.getByRole("heading", { name: fixture.title })).toBeVisible();
      await expect(page.getByText(fixture.foundation, { exact: false }).first()).toBeVisible();
      await expect(page.locator("main[data-room-screen]")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Back to room" })).toBeVisible();
      await expect(page.locator("iframe, canvas")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const first = page.locator("[data-tactile-item]").first();
      if (await first.count()) {
        await first.locator("summary").click();
        await expect(first.getByRole("link")).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    });
  }
  test("Discogs format filters remain server navigable", async ({ page }) => {
    await page.goto("/play/collect");
    await page.getByRole("navigation", { name: "Record formats" }).getByRole("link", { name: /^Vinyl/ }).click();
    await expect(page).toHaveURL(/format=vinyl/);
    await expect(page.locator("[data-record-crate] > li")).toHaveCount(3);
  });
});

test.describe("forced colors and reduced motion object screens", () => {
  test.use({ forcedColors: "active", reducedMotion: "reduce", viewport: { width: 320, height: 844 } });
  for (const object of objects) {
    test(`${object}: native keyboard interactions`, async ({ page }) => {
      await page.goto(`/play/${object}`, { waitUntil: "networkidle" });
      const first = page.locator("[data-tactile-item]").first();
      if (await first.count()) {
        await first.locator("summary").focus();
        await page.keyboard.press("Enter");
        await expect(first).toHaveAttribute("open", "");
        await expect(first.getByRole("link")).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
    });
  }
});

  test("Spotify remains consent-gated on the Listen object route", async ({ page }) => {
    const connectorRequests = [];
    const providerRequests = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/connectors/spotify")) connectorRequests.push(url);
      if (url.startsWith("https://open.spotify.com/")) providerRequests.push(url);
    });

    const response = await page.goto("/play/listen?fixture=ready", {
      waitUntil: "networkidle",
    });
    expect(response?.headers()["content-security-policy"]).toContain(
      "frame-src 'none'",
    );
    await expect(page.getByRole("heading", { name: "Top Tracks, in returned order." })).toBeVisible();
    expect(connectorRequests).toEqual([]);
    expect(providerRequests).toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);

    const listenHere = page.getByRole("button", { name: "Listen here" }).first();
    await listenHere.click();
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(providerRequests).toEqual([]);
    await page.getByRole("button", { name: "Load Spotify player" }).click();
    const spotifyFrame = page.locator('iframe[title*="Spotify"]');
    await expect(spotifyFrame).toHaveCount(1);
    await expect(spotifyFrame).toHaveAttribute(
      "src",
      /^https:\/\/open\.spotify\.com\/embed\/track\//,
    );
    await spotifyFrame.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    expect(providerRequests).toEqual([]);
    await page.getByRole("button", { name: "Close player" }).click();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(listenHere).toBeFocused();
  });

  test("Strava remains consent-gated on the Move object route", async ({ page }) => {
    const connectorRequests = [];
    const providerRequests = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/connectors/strava")) connectorRequests.push(url);
      if (
        url.startsWith("https://www.strava.com/") ||
        url.startsWith("https://strava-embeds.com/")
      ) {
        providerRequests.push(url);
      }
    });

    const response = await page.goto("/play/move?fixture=ready", {
      waitUntil: "networkidle",
    });
    expect(response?.headers()["content-security-policy"]).toContain(
      "frame-src 'none'",
    );
    await expect(page.getByRole("button", { name: "Load public Strava feed" })).toBeVisible();
    expect(connectorRequests).toEqual([]);
    expect(providerRequests).toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);

    await page.getByRole("button", { name: "Load public Strava feed" }).click();
    const stravaFrame = page.locator('iframe[title*="Strava"]');
    await expect(stravaFrame).toHaveCount(1);
    await expect(stravaFrame).toHaveAttribute(
      "src",
      /^https:\/\/www\.strava\.com\/athletes\/99999999999999999999\/latest-rides\//,
    );
    await stravaFrame.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    expect(providerRequests).toEqual([]);
  });


  test("no-JavaScript pagination preserves fixtures and gallery view", async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/play/watch?fixture=maximum-density&pageSize=12", {
      waitUntil: "load",
    });
    await expect(page.locator('input[name="fixture"]')).toHaveValue(
      "maximum-density",
    );
    const next = page.getByRole("link", { name: "Next" });
    const nextHref = await next.getAttribute("href");
    expect(nextHref).not.toBeNull();
    expect(new URL(nextHref, "http://preview.test").searchParams.get("fixture")).toBe(
      "maximum-density",
    );
    await next.click();
    await expect(page).toHaveURL(/fixture=maximum-density/);
    await expect(page.getByText("13—24 of 36")).toBeVisible();

    await page.goto("/play/collect?view=pattern&fixture=maximum-density", {
      waitUntil: "load",
    });
    const openDiscogsShelf = page.getByRole("link", {
      name: "Open the searchable release shelf",
    });
    await expect(openDiscogsShelf).toHaveAttribute(
      "href",
      "/play/collect?view=gallery&fixture=maximum-density",
    );
    await openDiscogsShelf.click();
    await expect(page).toHaveURL(/view=gallery/);
    await expect(page.locator('input[name="view"]')).toHaveValue("gallery");
    await expect(page.locator('input[name="fixture"]')).toHaveValue(
      "maximum-density",
    );
    const nextDiscogs = page.getByRole("link", { name: "Next" });
    const nextDiscogsHref = await nextDiscogs.getAttribute("href");
    expect(nextDiscogsHref).not.toBeNull();
    const nextDiscogsUrl = new URL(nextDiscogsHref, "http://preview.test");
    expect(nextDiscogsUrl.searchParams.get("view")).toBe("gallery");
    expect(nextDiscogsUrl.searchParams.get("fixture")).toBe("maximum-density");
    await nextDiscogs.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("13—24 of 36")).toBeVisible();

    await context.close();
  });
