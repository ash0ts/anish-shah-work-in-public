import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = ["/", "/about", "/work", "/play", "/sources", "/privacy"];
const widths = [320, 390, 640, 768, 1024, 1440, 1920];

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

function parseNeedleAngle(transform) {
  const match = /^rotate\((-?\d+(?:\.\d+)?) 210 210\)$/.exec(
    transform ?? "",
  );
  if (!match) throw new Error(`Unexpected Spotify needle transform: ${transform}`);
  return Number(match[1]);
}

function circularAngleDistance(left, right) {
  const normalized = (angle) => ((angle % 360) + 360) % 360;
  const distance = Math.abs(normalized(left) - normalized(right));
  return Math.min(distance, 360 - distance);
}

test("About and Work load only approved first-party brand artwork", async ({
  baseURL,
  page,
}) => {
  const firstPartyOrigin = new URL(baseURL).origin;
  const remoteImageRequests = [];
  page.on("request", (request) => {
    if (request.resourceType() !== "image") return;
    const url = new URL(request.url());
    if (url.origin !== firstPartyOrigin) {
      remoteImageRequests.push(request.url());
    }
  });

  for (const [route, expectedCount] of [
    ["/about", 1],
    ["/work", 5],
  ]) {
    await page.goto(route, { waitUntil: "networkidle" });
    const artwork = page.locator('img[src^="/assets/organizations/"]');
    await expect(artwork).toHaveCount(expectedCount);
    for (const src of await artwork.evaluateAll((images) =>
      images.map((image) => image.getAttribute("src")),
    )) {
      expect(src).toMatch(/^\/assets\/organizations\/[a-z0-9.-]+\.(?:svg|png)$/u);
    }
  }

  const openAiFallback = page.getByRole("link", { name: /^OpenAI:/u });
  await expect(openAiFallback.getByText("OpenAI", { exact: true })).toBeVisible();
  await expect(openAiFallback.locator("img")).toHaveCount(0);
  expect(remoteImageRequests).toEqual([]);
});

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

test("the primary navigation signal lens follows the active route", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  const home = navigation.getByRole("link", { name: "Anish Shah, home" });
  const about = navigation.getByRole("link", { name: "About" });
  const work = navigation.getByRole("link", { name: "Work" });
  const play = navigation.getByRole("link", { name: "Play" });
  const indicator = navigation.locator("[data-primary-navigation-indicator]");
  const siteHeader = page.getByRole("banner");
  const initialHeaderHeight = await siteHeader.evaluate(
    (element) => element.getBoundingClientRect().height,
  );

  await expect(navigation).toHaveAttribute("data-enhanced", "true");
  await expect(navigation).toHaveAttribute("data-active-key", "home");
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(about).not.toHaveAttribute("aria-current", "page");
  await expect(work).not.toHaveAttribute("aria-current", "page");
  await expect(play).not.toHaveAttribute("aria-current", "page");
  await expect.poll(() => signalLensAlignment(navigation)).toBeLessThanOrEqual(1);

  await about.click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(navigation).toHaveAttribute("data-active-key", "about");
  await expect(about).toHaveAttribute("aria-current", "page");
  await expect(home).not.toHaveAttribute("aria-current", "page");
  await expect(work).not.toHaveAttribute("aria-current", "page");
  await expect(play).not.toHaveAttribute("aria-current", "page");
  await expect.poll(() => signalLensAlignment(navigation)).toBeLessThanOrEqual(1);

  await work.click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(navigation).toHaveAttribute("data-active-key", "work");
  await expect(work).toHaveAttribute("aria-current", "page");
  await expect(about).not.toHaveAttribute("aria-current", "page");
  await expect(home).not.toHaveAttribute("aria-current", "page");
  await expect(play).not.toHaveAttribute("aria-current", "page");
  await expect.poll(() => signalLensAlignment(navigation)).toBeLessThanOrEqual(1);

  await play.click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(navigation).toHaveAttribute("data-active-key", "play");
  await expect(play).toHaveAttribute("aria-current", "page");
  await expect(about).not.toHaveAttribute("aria-current", "page");
  await expect(home).not.toHaveAttribute("aria-current", "page");
  await expect(work).not.toHaveAttribute("aria-current", "page");
  await expect.poll(() => signalLensAlignment(navigation)).toBeLessThanOrEqual(1);
  await expect(indicator).toBeVisible();

  await home.focus();
  await expect(home).toBeFocused();
  await home.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(navigation).toHaveAttribute("data-active-key", "home");
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect.poll(() => signalLensAlignment(navigation)).toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      page
        .getByRole("banner")
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(initialHeaderHeight);
});

test("reduced motion positions the primary navigation lens without a transition", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });

  await navigation.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(navigation).toHaveAttribute("data-active-key", "about");
  await expect.poll(() => signalLensAlignment(navigation)).toBeLessThanOrEqual(1);
});

async function signalLensAlignment(navigation) {
  return navigation.evaluate((element) => {
    const active = element.querySelector('[aria-current="page"]');
    const indicator = element.querySelector(
      "[data-primary-navigation-indicator]",
    );
    if (!(active instanceof HTMLElement) || !(indicator instanceof HTMLElement)) {
      return Number.POSITIVE_INFINITY;
    }
    const activeBounds = active.getBoundingClientRect();
    const indicatorBounds = indicator.getBoundingClientRect();
    return Math.max(
      Math.abs(activeBounds.left - indicatorBounds.left),
      Math.abs(activeBounds.width - indicatorBounds.width),
    );
  });
}

test("mobile Work keeps search, calendar years, and filter-sheet focus synchronized", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/work", { waitUntil: "networkidle" });

  const search = page.getByRole("searchbox", {
    name: "Search the work",
  });
  const calendar = page.getByRole("region", {
    name: /Work timeline table/,
  });
  await expect(search).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Line of work" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Year" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Topic" })).toBeVisible();
  await expect(calendar).toBeVisible();
  const calendarBounds = await calendar.boundingBox();
  expect(calendarBounds?.y ?? Infinity).toBeLessThan(844);
  await expect(page.locator('[data-work-year="2026"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("group", {
      name: "Choose a year to view in the work calendar",
    }),
  ).toHaveAttribute("data-ready", "true");
  const initialRailAlignment = await page.locator("[data-year-rail]").evaluate(
    (rail) => {
      const selected = rail.querySelector('[data-work-year="2026"]');
      if (!(selected instanceof HTMLElement)) return Infinity;
      const railBox = rail.getBoundingClientRect();
      const buttonBox = selected.getBoundingClientRect();
      return Math.abs(
        buttonBox.left + buttonBox.width / 2 -
          (railBox.left + railBox.width / 2),
      );
    },
  );
  expect(initialRailAlignment).toBeLessThanOrEqual(2);

  await page.locator('[data-work-year="2024"]').click();
  await expect(page.locator('[data-work-year="2024"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(calendar).toHaveAttribute("data-mobile-year", "2024");
  await expect(calendar.locator('[data-timeline-year="2024"]')).toBeVisible();
  await expect(calendar.locator('[data-timeline-year="2025"]')).toBeHidden();
  const calendarWidths = await calendar.evaluate((frame) => ({
    client: frame.clientWidth,
    scroll: frame.scrollWidth,
  }));
  expect(calendarWidths.scroll).toBeLessThanOrEqual(
    calendarWidths.client + 1,
  );
  const railAlignment = await page.locator("[data-year-rail]").evaluate(
    (rail) => {
      const selected = rail.querySelector('[data-work-year="2024"]');
      if (!(selected instanceof HTMLElement)) return Infinity;
      const railBox = rail.getBoundingClientRect();
      const buttonBox = selected.getBoundingClientRect();
      return Math.abs(
        buttonBox.left + buttonBox.width / 2 -
          (railBox.left + railBox.width / 2),
      );
    },
  );
  expect(railAlignment).toBeLessThanOrEqual(2);

  const filters = page.getByRole("button", { name: /^Filters/ });
  await filters.click();
  const dialog = page.getByRole("dialog", { name: "Filter the calendar" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Format" })).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Line of work" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close filters" }).click();
  await expect(filters).toBeFocused();

  await expect(page.locator("details[data-work-body][open]")).toHaveCount(0);
  await expect(page.locator("li[data-work-id]")).toHaveCount(0);
  await expect(page.locator("#work-index")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "The work crosses companies, projects, and technical communities.",
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: /Google Cloud:/ }).click();
  await expect(page).toHaveURL(
    /\/work\?organization=google-cloud#work-index$/,
  );
  await expect(page.locator("#work-index-title")).toHaveText(
    "Google Cloud projects",
  );
  await expect(page.locator("#work-index-title")).toBeFocused();
  await expect(page.locator("li[data-work-id]")).toHaveCount(7);

  await page.goto("/work", { waitUntil: "networkidle" });
  await expect(page.locator("#work-index")).toHaveCount(0);
  await page.locator('[data-work-year="2024"]').click();

  await calendar
    .getByRole("link", {
      name: /projects in Agent systems & open source, 2024/,
    })
    .click();
  await expect(page).toHaveURL(
    /\/work\?bucket=products-open-source&year=2024#work-index$/,
  );
  await expect(page.locator("li[data-work-id]").first()).toBeVisible();
  await expect(page.locator("#work-index-title")).toBeFocused();

  await page.goto("/work?year=2024", { waitUntil: "networkidle" });
  await expect(page.locator("li[data-work-id]")).toHaveCount(24);
  await page.getByRole("link", { name: "Page 2" }).click();
  await expect(page).toHaveURL(/\/work\?year=2024&page=2#work-index$/);
  await expect(page.locator("li[data-work-id]").first()).toBeVisible();
  await expect(page.locator("#work-index-title")).toBeFocused();

  const overflow = await pageOverflow(page);
  expect(overflow.offenders).toEqual([]);
  expect(overflow.documentWidth).toBeLessThanOrEqual(391);
});

test("mobile Work keeps primary filter actions readable at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/work", { waitUntil: "networkidle" });

  const filters = page.getByRole("button", { name: /^Filters/ });
  const submit = page.getByRole("button", { name: "Show projects" });
  await expect(filters).toBeVisible();
  await expect(submit).toBeVisible();

  const actionLayout = await Promise.all([
    filters.boundingBox(),
    submit.boundingBox(),
    submit.evaluate((button) => ({
      clientWidth: button.clientWidth,
      scrollWidth: button.scrollWidth,
      whiteSpace: getComputedStyle(button).whiteSpace,
    })),
  ]);
  const [filterBox, submitBox, submitStyle] = actionLayout;
  expect(Math.abs((filterBox?.height ?? 0) - (submitBox?.height ?? 0))).toBeLessThanOrEqual(1);
  expect(submitStyle.scrollWidth).toBeLessThanOrEqual(
    submitStyle.clientWidth + 1,
  );
  expect(submitStyle.whiteSpace).toBe("nowrap");

  const selected = page.locator('[data-work-year="2026"]');
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  const selectedVisibility = await selected.evaluate((button) => {
    const rail = button.closest("[data-year-rail]");
    if (!(rail instanceof HTMLElement)) return false;
    const railBox = rail.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    return (
      buttonBox.left >= railBox.left - 1 &&
      buttonBox.right <= railBox.right + 1
    );
  });
  expect(selectedVisibility).toBe(true);

  const overflow = await pageOverflow(page);
  expect(overflow.offenders).toEqual([]);
  expect(overflow.documentWidth).toBeLessThanOrEqual(321);
});

test("Work supporting material is mobile-collapsible and fragment-safe", async ({
  page,
}) => {
  const route = "/work/architecting-and-orchestrating-ai-agents-series";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route, { waitUntil: "networkidle" });
  const appearances = page.locator(
    "details[data-supporting-disclosure]:has(#appearances-title)",
  );
  await expect(appearances).not.toHaveAttribute("open", "");
  await expect(appearances.locator(":scope > ol")).not.toBeVisible();
  await appearances.locator(":scope > summary").click();
  await expect(appearances.locator(":scope > ol")).toBeVisible();
  const firstAnchor = await appearances.locator(":scope > ol > li").first().getAttribute("id");
  expect(firstAnchor).toBeTruthy();

  await page.goto(`${route}#${firstAnchor}`, { waitUntil: "networkidle" });
  const anchored = page.locator(
    "details[data-supporting-disclosure]:has(#appearances-title)",
  );
  await expect(anchored).toHaveAttribute("open", "");
  await expect(page.locator(`[id="${firstAnchor}"]`)).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(route, { waitUntil: "networkidle" });
  const desktopAppearances = page.locator(
    "details[data-supporting-disclosure]:has(#appearances-title)",
  );
  await expect(desktopAppearances.locator(":scope > ol")).toBeVisible();
});

test("Spotify rank navigation and consent remain keyboard-first", async ({ page }) => {
  await page.route("https://open.spotify.com/embed/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      status: 200,
      body: "<!doctype html><title>Spotify embed fixture</title>",
    });
  });

  await page.goto("/play/listen", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Top Tracks, in returned order." })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);

  const rankList = page.getByRole("list", {
    name: "Spotify Top Tracks in returned order",
  });
  const ranks = rankList.getByRole("button");
  await expect(ranks).toHaveCount(12);
  const firstRank = ranks.nth(0);
  const secondRank = ranks.nth(1);
  await expect(firstRank).toHaveAccessibleName(/^Rank 1, .+ by .+$/);
  await expect(secondRank).toHaveAccessibleName(/^Rank 2, .+ by .+$/);
  await firstRank.focus();
  await firstRank.press("ArrowRight");
  await expect(secondRank).toBeFocused();
  await expect(secondRank).toHaveAttribute("aria-pressed", "true");

  const listenHere = page.getByRole("button", { name: "Listen here" }).first();
  await listenHere.click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Load Spotify player" }).click();
  await expect(page.locator('iframe[title^="Listen to "]')).toHaveCount(1);
  await page.getByRole("button", { name: "Close player" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(listenHere).toBeFocused();
});

test("Spotify groove needle stays continuous through interrupted selections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/play/listen", { waitUntil: "networkidle" });

  const needle = page.locator("[data-spotify-groove-needle]");
  const controls = page.locator("[data-spotify-groove-controls] button");
  await expect(controls).toHaveCount(12);
  await expect(needle).toHaveAttribute("transform", /^rotate\(/);

  const interruptionJumps = await page.evaluate(async () => {
    const needleElement = document.querySelector(
      "[data-spotify-groove-needle]",
    );
    const buttons = [
      ...document.querySelectorAll("[data-spotify-groove-controls] button"),
    ];
    if (!(needleElement instanceof SVGGElement) || buttons.length !== 12) {
      throw new Error("The Spotify groove controls are not ready.");
    }
    const angle = () => {
      const match = /^rotate\((-?\d+(?:\.\d+)?) 210 210\)$/.exec(
        needleElement.getAttribute("transform") ?? "",
      );
      if (!match) throw new Error("The Spotify needle rotation is malformed.");
      return Number(match[1]);
    };
    const distance = (left, right) => {
      const normalize = (value) => ((value % 360) + 360) % 360;
      const difference = Math.abs(normalize(left) - normalize(right));
      return Math.min(difference, 360 - difference);
    };
    const sequence = [6, 1, 10, 3, 8, 0, 11, 5, 2, 9, 4];
    const jumps = [];
    for (const index of sequence) {
      const before = angle();
      buttons[index].click();
      const after = angle();
      jumps.push(distance(before, after));
      await new Promise((resolve) => window.setTimeout(resolve, 12));
    }
    return jumps;
  });

  expect(Math.max(...interruptionJumps)).toBeLessThanOrEqual(1);
  await expect.poll(async () => {
    return circularAngleDistance(
      parseNeedleAngle(await needle.getAttribute("transform")),
      120,
    );
  }).toBeLessThanOrEqual(1);
  await expect(controls.nth(4)).toHaveAttribute("aria-pressed", "true");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await controls.nth(10).click();
  expect(
    circularAngleDistance(
      parseNeedleAngle(await needle.getAttribute("transform")),
      300,
    ),
  ).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Last approximately 6 months" }).click();
  expect(
    circularAngleDistance(
      parseNeedleAngle(await needle.getAttribute("transform")),
      0,
    ),
  ).toBeLessThanOrEqual(1);
});

test("Discogs remains lazy until the Record crate route is selected", async ({ page }) => {
  const connectorRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/connectors/discogs") {
      connectorRequests.push(request.url());
    }
  });
  await page.goto("/play", { waitUntil: "networkidle" });
  expect(connectorRequests).toHaveLength(0);
  await page.locator('[data-room-object-link="collect"]').click();
  await expect(page).toHaveURL(/\/play\/collect$/);
  await expect(
    page.getByRole("region", { name: "Discogs physical catalog" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Crate Archive" }),
  ).toBeVisible();
  expect(connectorRequests).toHaveLength(0);
});

test("legacy Play stream links redirect permanently and reject unknown selections", async ({
  page,
  request,
}) => {
  const redirect = await request.get("/play?stream=collect", {
    maxRedirects: 0,
  });
  expect(redirect.status()).toBe(308);
  expect(new URL(redirect.headers().location).pathname).toBe("/play/collect");

  await page.goto("/play?stream=collect", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/play\/collect$/);
  await expect(
    page.getByRole("region", { name: "Discogs physical catalog" }),
  ).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("region", { name: "Discogs physical catalog" }),
  ).toBeVisible();

  await page.goto("/play?stream=unknown", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/play\?stream=unknown$/);
  await expect(page.locator("[data-room-overview]")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, follow",
  );
});

test("Discogs Overview and Browse all support filters and pagination", async ({ page }) => {
  await page.goto("/play/collect", { waitUntil: "networkidle" });

  const physicalTotal = page.getByText("physical items", { exact: true }).locator("..");
  const releaseTotal = page.getByText("distinct releases", { exact: true }).locator("..");
  await expect(physicalTotal.getByText("16", { exact: true })).toBeVisible();
  await expect(releaseTotal.getByText("14", { exact: true })).toBeVisible();
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

  await page.getByRole("button", { name: "Browse all" }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("view") === "gallery",
  );
  await expect(page.getByText("1—12 of 14 releases")).toBeVisible();
  await expect(page.locator("ol li").filter({ has: page.locator('a[href*="discogs.com/release/"]') })).toHaveCount(12);

  await page
    .getByRole("navigation", { name: "Discogs catalog pages" })
    .getByRole("link", { name: /^Next/ })
    .click();
  await expect(page.getByText("13—14 of 14 releases")).toBeVisible();
  await expect(page.locator("ol[role='list']")).toHaveAttribute("start", "13");
  await expect(page).toHaveURL(/page=2/);

  await page.getByRole("combobox", { name: /^Per page/ }).selectOption("24");
  await expect(page.getByText("1—14 of 14 releases")).toBeVisible();
  await expect(page).toHaveURL(/pageSize=24/);

  await page.getByRole("combobox", { name: /^Format/ }).selectOption("vinyl");
  await expect(page).toHaveURL(/format=vinyl/);
  await page.getByRole("combobox", { name: /^Sort/ }).selectOption("year");
  await expect(page).toHaveURL(/sort=year/);

  await page
    .getByRole("searchbox", { name: /^Find a title or artist/ })
    .fill("Physical Signal 12");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("1—1 of 1 releases")).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /Physical Signal 12.*Synthetic Artist 5/i,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=Physical(?:\+|%20)Signal(?:\+|%20)12/);

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

test("Discogs Overview and Browse all fit 320–1920px viewports", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/play/collect", { waitUntil: "networkidle" });
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expect(
      page.getByRole("region", { name: "Discogs physical catalog" }),
    ).toBeVisible();

    let overflow = await pageOverflow(page);
    expect(overflow, `Overview @ ${width}px: ${JSON.stringify(overflow.offenders)}`).toMatchObject({
      documentWidth: expect.any(Number),
      viewportWidth: width,
      offenders: [],
    });
    expect(overflow.documentWidth).toBeLessThanOrEqual(width + 1);

    await page.getByRole("button", { name: "Browse all" }).click();
    await expect(page.getByText("1—12 of 14 releases")).toBeVisible();
    overflow = await pageOverflow(page);
    expect(overflow, `Browse all @ ${width}px: ${JSON.stringify(overflow.offenders)}`).toMatchObject({
      documentWidth: expect.any(Number),
      viewportWidth: width,
      offenders: [],
    });
    expect(overflow.documentWidth).toBeLessThanOrEqual(width + 1);

    await page.getByRole("button", { name: "Overview" }).click();
    await expect(
      page.getByRole("table", {
        name: "Physical item counts by format and release decade",
      }),
    ).toBeVisible();
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
  await expect(page.locator('[data-room-overview] a[href^="/play/"]')).toHaveCount(7);
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
