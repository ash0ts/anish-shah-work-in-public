import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = ["/", "/work", "/play", "/sources", "/privacy"];
const widths = [320, 390, 640, 768, 1024, 1440, 1920];

for (const width of widths) {
  test(`public routes fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const route of routes) {
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status(), route).toBe(200);
      const overflow = await page.evaluate(() => {
        const limit = window.innerWidth + 1;
        const isInsideBoundedScroller = (element) => {
          let ancestor = element.parentElement;
          while (ancestor && ancestor !== document.body) {
            const overflowX = getComputedStyle(ancestor).overflowX;
            if (overflowX === "auto" || overflowX === "scroll") {
              const box = ancestor.getBoundingClientRect();
              return box.left >= -1 && box.right <= limit;
            }
            ancestor = ancestor.parentElement;
          }
          return false;
        };
        const offenders = [...document.querySelectorAll("body *")]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return (
              (box.right > limit || box.left < -1) &&
              !isInsideBoundedScroller(element)
            );
          })
          .slice(0, 12)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            id: element.id,
            className: String(element.className).slice(0, 120),
          }));
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          offenders,
        };
      });
      expect(overflow, `${route}: ${JSON.stringify(overflow.offenders)}`).toMatchObject({
        documentWidth: expect.any(Number),
        viewportWidth: width,
        offenders: [],
      });
      expect(overflow.documentWidth).toBeLessThanOrEqual(width + 1);
    }
  });
}

for (const route of routes) {
  test(`${route} has no serious or critical Axe findings`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route, { waitUntil: "networkidle" });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = result.violations.filter(({ impact }) =>
      ["serious", "critical"].includes(impact),
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}

test("skip navigation reaches the main content", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const skip = page.locator('a[href="#main"]').first();
  await skip.focus();
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await expect(page.locator("#main")).toBeVisible();
});

test("Spotify rank navigation and consent remain keyboard-first", async ({ page }) => {
  const timestamp = "2026-08-02T12:00:00.000Z";
  const tracks = [
    {
      id: "track-one",
      position: 1,
      title: "First Track",
      artists: [{ id: "artist-one", name: "First Artist" }],
      album: {
        id: "album-one",
        title: "First Album",
        releaseYear: 2025,
        artwork: null,
      },
      durationMs: 181_000,
      explicit: false,
    },
    {
      id: "track-two",
      position: 2,
      title: "Second Track",
      artists: [{ id: "artist-two", name: "Second Artist" }],
      album: {
        id: "album-two",
        title: "Second Album",
        releaseYear: 2024,
        artwork: null,
      },
      durationMs: 202_000,
      explicit: true,
    },
  ];
  await page.route("**/api/connectors/spotify", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        status: "ready",
        fetchedAt: timestamp,
        stale: false,
        payload: {
          provider: "spotify",
          profileUrl: "https://open.spotify.com/user/portfolio-owner",
          coverage: "Spotify-calculated affinity; not play counts",
          windows: {
            short_term: { tracks },
            medium_term: { tracks },
            long_term: { tracks },
          },
          syncedAt: timestamp,
          freshUntil: "2026-08-03T00:00:00.000Z",
        },
      }),
    });
  });
  await page.route("https://open.spotify.com/embed/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      status: 200,
      body: "<!doctype html><title>Spotify embed fixture</title>",
    });
  });

  await page.goto("/play", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Listen.*Spotify/i }).click();
  await expect(page.getByRole("heading", { name: "Top Tracks, in returned order." })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);

  const firstRank = page.getByRole("button", {
    name: "Rank 1, First Track by First Artist",
  });
  const secondRank = page.getByRole("button", {
    name: "Rank 2, Second Track by Second Artist",
  });
  await firstRank.focus();
  await firstRank.press("End");
  await expect(secondRank).toBeFocused();

  const listenHere = page.getByRole("button", { name: "Listen here" }).first();
  await listenHere.click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Load Spotify player" }).click();
  await expect(page.locator('iframe[title*="Second Track"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Close player" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(listenHere).toBeFocused();
});

test("forced colors and text spacing retain readable public content", async ({ browser }) => {
  const context = await browser.newContext({
    forcedColors: "active",
    reducedMotion: "reduce",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.addStyleTag({
    content:
      "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}",
  });
  await expect(page.locator("main")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await context.close();
});

test("public routes retain semantic fallbacks without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: "load" });
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  }
  await page.goto("/play", { waitUntil: "load" });
  await expect(page.locator("noscript details")).toHaveCount(5);
  await expect(page.locator("iframe")).toHaveCount(0);
  await context.close();
});

test("reduced-motion preference resolves to readable final states", async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  expect(
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
  ).toBe(true);
  await expect(page.locator("main")).toBeVisible();
  await context.close();
});
