import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installDiscogsFixture } from "./fixtures/discogs.mjs";

const routes = ["/", "/work", "/play", "/sources", "/privacy"];
const widths = [320, 390, 640, 768, 1024, 1440, 1920];
const roomMode = process.env.BROWSER_PLAY_MODE === "room";

async function pageOverflow(page) {
  return page.evaluate(() => {
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
}

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
  test.skip(roomMode, "Classic Play owns the tabbed Spotify interaction.");
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

test("Discogs remains lazy and the six Play streams use keyboard selection", async ({ page }) => {
  test.skip(roomMode, "Classic Play owns the tabbed Discogs interaction.");
  const requests = [];
  await installDiscogsFixture(page, requests);
  await page.goto("/play", { waitUntil: "networkidle" });

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(6);
  await expect(tabs).toHaveText([
    /Watch\s*MyAnimeList/,
    /Read\s*Hardcover/,
    /Listen\s*Spotify/,
    /Collect\s*Discogs/,
    /Play\s*Steam/,
    /Move\s*Strava/,
  ]);
  expect(requests).toHaveLength(0);

  const watch = page.getByRole("tab", { name: /Watch.*MyAnimeList/i });
  const read = page.getByRole("tab", { name: /Read.*Hardcover/i });
  const listen = page.getByRole("tab", { name: /Listen.*Spotify/i });
  const collect = page.getByRole("tab", { name: /Collect.*Discogs/i });
  await watch.focus();
  await watch.press("ArrowRight");
  await expect(read).toBeFocused();
  await read.press("ArrowRight");
  await expect(listen).toBeFocused();
  await listen.press("ArrowRight");
  await expect(collect).toBeFocused();
  await expect(collect).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Pressings and releases, kept distinct." }),
  ).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page).toHaveURL(/\/play\?stream=collect$/);
});

test("Play stream deep links survive reload and reject unknown selections", async ({ page }) => {
  const requests = [];
  await installDiscogsFixture(page, requests);

  await page.goto("/play?stream=collect", { waitUntil: "networkidle" });
  const collect = page.getByRole("tab", { name: /Collect.*Discogs/i });
  await expect(collect).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Pressings and releases, kept distinct." }),
  ).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);

  await page.reload({ waitUntil: "networkidle" });
  await expect(collect).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Pressings and releases, kept distinct." }),
  ).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);

  await page.goto("/play?stream=unknown", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("tab", { name: /Watch.*MyAnimeList/i }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, follow",
  );
});

test("Discogs Pattern and Gallery support filters and pagination", async ({ page }) => {
  test.skip(roomMode, "Classic Play exercises the shared Discogs presentation with browser fixtures.");
  const requests = [];
  await installDiscogsFixture(page, requests);
  await page.goto("/play", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Collect.*Discogs/i }).click();

  const physicalTotal = page.getByText("physical items", { exact: true }).locator("..");
  const releaseTotal = page.getByText("distinct releases", { exact: true }).locator("..");
  await expect(physicalTotal.getByText("29", { exact: true })).toBeVisible();
  await expect(releaseTotal.getByText("26", { exact: true })).toBeVisible();
  const matrix = page.getByRole("table", {
    name: "Physical item counts by format and release decade",
  });
  await expect(matrix).toBeVisible();
  await expect(matrix.getByRole("columnheader", { name: "Format" })).toBeVisible();
  let axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    axe.violations.filter(({ impact }) =>
      ["serious", "critical"].includes(impact),
    ),
    JSON.stringify(axe.violations, null, 2),
  ).toEqual([]);

  await page.getByRole("button", { name: "Gallery" }).click();
  await expect(page.getByText("1—12 of 26 releases")).toBeVisible();
  await expect(page.locator("ol li").filter({ has: page.locator('a[href*="discogs.com/release/"]') })).toHaveCount(12);

  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText("13—24 of 26 releases")).toBeVisible();
  await expect(page.locator("ol[role='list']")).toHaveAttribute("start", "13");
  await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("2");

  await page.getByRole("combobox", { name: /^Per page/ }).selectOption("24");
  await expect(page.getByText("1—24 of 26 releases")).toBeVisible();
  await expect.poll(() => requests.at(-1)?.searchParams.get("pageSize")).toBe("24");

  await page.getByRole("combobox", { name: /^Format/ }).selectOption("vinyl");
  await expect.poll(() => requests.at(-1)?.searchParams.get("format")).toBe("vinyl");
  await page.getByRole("combobox", { name: /^Sort/ }).selectOption("year");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sort")).toBe("year");

  await page.getByRole("searchbox", { name: /^Find a title or artist/ }).fill("Blue Logic");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("1—1 of 1 releases")).toBeVisible();
  await expect(page.getByRole("link", { name: /Blue Logic.*Arc Lab/i })).toBeVisible();
  await expect.poll(() => requests.at(-1)?.searchParams.get("q")).toBe("Blue Logic");

  axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    axe.violations.filter(({ impact }) =>
      ["serious", "critical"].includes(impact),
    ),
    JSON.stringify(axe.violations, null, 2),
  ).toEqual([]);
});

test("Discogs Pattern and Gallery fit 320–1920px viewports", async ({ page }) => {
  test.skip(roomMode, "Room routes receive server-selected connector state; their layout matrix is covered separately.");
  await installDiscogsFixture(page);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: /Collect.*Discogs/i }).click();
    await expect(
      page.getByRole("heading", { name: "Pressings and releases, kept distinct." }),
    ).toBeVisible();

    let overflow = await pageOverflow(page);
    expect(overflow, `Pattern @ ${width}px: ${JSON.stringify(overflow.offenders)}`).toMatchObject({
      documentWidth: expect.any(Number),
      viewportWidth: width,
      offenders: [],
    });
    expect(overflow.documentWidth).toBeLessThanOrEqual(width + 1);

    await page.getByRole("button", { name: "Gallery" }).click();
    await expect(page.getByText("1—12 of 26 releases")).toBeVisible();
    overflow = await pageOverflow(page);
    expect(overflow, `Gallery @ ${width}px: ${JSON.stringify(overflow.offenders)}`).toMatchObject({
      documentWidth: expect.any(Number),
      viewportWidth: width,
      offenders: [],
    });
    expect(overflow.documentWidth).toBeLessThanOrEqual(width + 1);
  }
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
  if (roomMode) {
    await expect(page.locator('[data-room-overview] a[href^="/play/"]')).toHaveCount(6);
  } else {
    await expect(page.locator("noscript details")).toHaveCount(6);
  }
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
