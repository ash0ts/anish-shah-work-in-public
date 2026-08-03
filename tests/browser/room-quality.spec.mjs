import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const roomMode = process.env.BROWSER_PLAY_MODE === "room";
const objects = [
  { id: "watch", provider: "myanimelist", title: "Midnight Broadcast" },
  { id: "read", provider: "hardcover", title: "Borrowed Shelf" },
  { id: "listen", provider: "spotify", title: "Pocket Player" },
  { id: "collect", provider: null, title: "Crate Archive" },
  { id: "play", provider: "steam", title: "Desktop Library" },
  { id: "move", provider: "strava", title: "Cardio Television" },
];
const directRoutes = objects.map(({ id }) => `/play/${id}`);
const widths = [320, 390, 768, 1024, 1440, 1920];

function runtimeChunkRequests(page) {
  const urls = [];
  page.on("request", (request) => {
    if (
      request.resourceType() === "script" &&
      /(?:RoomRuntime|RoomStage|react-three|three(?:[.-]|$))/i.test(
        new URL(request.url()).pathname,
      )
    ) {
      urls.push(request.url());
    }
  });
  return urls;
}

async function instrumentDrawCalls(page) {
  await page.addInitScript(() => {
    const metrics = { currentFrame: 0, maximumFrame: 0, total: 0 };
    Object.defineProperty(window, "__roomDrawMetrics", {
      configurable: false,
      value: metrics,
    });

    for (const contextName of ["WebGL2RenderingContext", "WebGLRenderingContext"]) {
      const Context = window[contextName];
      if (!Context) continue;
      for (const method of [
        "drawArrays",
        "drawElements",
        "drawArraysInstanced",
        "drawElementsInstanced",
      ]) {
        const original = Context.prototype[method];
        if (typeof original !== "function") continue;
        Context.prototype[method] = function (...args) {
          metrics.currentFrame += 1;
          metrics.total += 1;
          return original.apply(this, args);
        };
      }
    }

    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      nativeRequestAnimationFrame((time) => {
        metrics.currentFrame = 0;
        try {
          callback(time);
        } finally {
          metrics.maximumFrame = Math.max(
            metrics.maximumFrame,
            metrics.currentFrame,
          );
        }
      });
  });
}

async function overflowReport(page) {
  return page.evaluate(() => {
    const limit = window.innerWidth + 1;
    const insideBoundedScroller = (element) => {
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
          (box.left < -1 || box.right > limit) &&
          !insideBoundedScroller(element)
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

function spotifyFixture() {
  const timestamp = new Date().toISOString();
  const tracks = [
    {
      id: "1".repeat(22),
      position: 1,
      title: "A Long Walk Through the Quietest Part of the Evening",
      artists: [{ id: "2".repeat(22), name: "Fixture Artist" }],
      album: {
        id: "3".repeat(22),
        title: "Fixture Album",
        releaseYear: 2001,
        artwork: null,
      },
      durationMs: 201_000,
      explicit: false,
    },
    {
      id: "4".repeat(22),
      position: 2,
      title: "Second Track",
      artists: [{ id: "5".repeat(22), name: "Another Artist" }],
      album: {
        id: "6".repeat(22),
        title: "Second Album",
        releaseYear: 2002,
        artwork: null,
      },
      durationMs: 189_000,
      explicit: true,
    },
  ];
  return {
    status: "ready",
    fetchedAt: timestamp,
    stale: false,
    payload: {
      provider: "spotify",
      profileUrl: `https://open.spotify.com/user/${"7".repeat(22)}`,
      coverage: "Spotify-calculated affinity; not play counts",
      windows: {
        short_term: { tracks },
        medium_term: { tracks },
        long_term: { tracks },
      },
      syncedAt: timestamp,
      freshUntil: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    },
  };
}

function stravaFixture() {
  const timestamp = new Date().toISOString();
  return {
    status: "ready",
    provider: "strava",
    payload: {
      provider: "strava",
      profileUrl: "https://www.strava.com/athletes/37597587",
      embed: {
        kind: "profile_feed",
        embedUrl:
          "https://www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
        checkedAt: timestamp,
      },
      embedStatus: "available",
      updatedAt: timestamp,
    },
  };
}

test.describe("My Room 2001 browser quality", () => {
  test.skip(!roomMode, "The room suite runs against its dedicated Worker mode.");

  test("the overview is provider-free and defers the room runtime until intent", async ({
    page,
  }) => {
    const connectors = [];
    const runtimeScripts = runtimeChunkRequests(page);
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/connectors/")) {
        connectors.push(request.url());
      }
    });

    const response = await page.goto("/play", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Come in. Pick something up." })).toBeVisible();
    await expect(page.locator('[data-room-overview] a[href^="/play/"]')).toHaveCount(6);
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(connectors).toEqual([]);
    expect(runtimeScripts).toEqual([]);
  });

  test("direct routes load only their own provider", async ({ page }) => {
    const requests = [];
    await page.route("**/api/connectors/**", async (route) => {
      requests.push(new URL(route.request().url()).pathname);
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          status: "unavailable",
          message: "Deterministic browser fixture",
        }),
      });
    });

    for (const object of objects) {
      requests.length = 0;
      await page.goto(`/play/${object.id}`, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: object.title })).toBeVisible();
      expect([...new Set(requests)]).toEqual(
        object.provider ? [`/api/connectors/${object.provider}`] : [],
      );
    }
  });

  test("Enter traps focus and Leave restores the invoking control", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    const enter = page.getByRole("button", { name: "Enter the room" });
    await expect(enter).toBeVisible();
    await enter.click();

    const room = page.getByRole("dialog", { name: "Interactive room" });
    const leave = room.getByRole("button", { name: "Leave room" });
    const lastObject = room.locator('[data-room-object-control="move"]');
    await expect(room).toBeVisible();
    await expect(leave).toBeFocused();
    await expect(page.locator("body > header")).toHaveAttribute("inert", "");
    await expect(page.locator("[data-room-overview]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(room.locator("[data-room-runtime-announcer]")).toContainText(
      "Interactive room opened.",
    );
    const roomBounds = await room.boundingBox();
    expect(roomBounds).not.toBeNull();
    expect(roomBounds.x).toBeLessThanOrEqual(1);
    expect(roomBounds.y).toBeLessThanOrEqual(1);
    expect(roomBounds.width).toBeGreaterThanOrEqual(1439);
    expect(roomBounds.height).toBeGreaterThanOrEqual(899);

    await lastObject.focus();
    await lastObject.press("Tab");
    await expect(leave).toBeFocused();
    await leave.press("Shift+Tab");
    await expect(lastObject).toBeFocused();

    const turnLeft = room.getByRole("button", { name: "Turn left" });
    await turnLeft.click();
    await turnLeft.click();
    await turnLeft.click();
    await expect(turnLeft).toBeDisabled();
    await expect(turnLeft).toHaveAttribute("aria-disabled", "true");

    await leave.click();
    await expect(room).toHaveCount(0);
    await expect(enter).toBeFocused();
    await expect(page.locator("body > header")).not.toHaveAttribute("inert", "");
  });

  test("the shipped perspective room stays inside the actual draw-call gate", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await instrumentDrawCalls(page);
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter the room" }).click();
    await expect(page.locator('[data-projection="wide-perspective"]')).toBeVisible();
    await expect(page.getByText("Room ready")).toBeVisible();
    await page.getByRole("button", { name: "Turn right" }).click();
    await page.waitForTimeout(150);

    const metrics = await page.evaluate(() => window.__roomDrawMetrics);
    expect(metrics.total).toBeGreaterThan(0);
    expect(metrics.maximumFrame).toBeLessThanOrEqual(50);
  });

  test("room-originated Back and Escape use browser history and restore exact focus", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter the room" }).click();
    let room = page.getByRole("dialog", { name: "Interactive room" });
    await room.locator('[data-room-object-control="watch"]').click();
    await expect(page).toHaveURL(/\/play\/watch$/);
    await expect(page.locator("[data-room-screen]")).toBeFocused();
    await expect(page.locator("[data-room-announcer]")).toContainText(
      "Opened Watch: Midnight Broadcast.",
    );

    await page.getByRole("link", { name: "Back to room" }).click();
    await expect(page).toHaveURL(/\/play$/);
    room = page.getByRole("dialog", { name: "Interactive room" });
    await expect(room).toBeVisible();
    await expect(room.locator('[data-room-object-control="watch"]')).toBeFocused();

    await page.goForward({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/play\/watch$/);
    await expect(page.locator("[data-room-screen]")).toBeFocused();
    await page.goBack({ waitUntil: "networkidle" });
    room = page.getByRole("dialog", { name: "Interactive room" });
    await expect(room.locator('[data-room-object-control="watch"]')).toBeFocused();

    await room.locator('[data-room-object-control="read"]').click();
    await expect(page).toHaveURL(/\/play\/read$/);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/play$/);
    room = page.getByRole("dialog", { name: "Interactive room" });
    await expect(room).toBeVisible();
    await expect(room.locator('[data-room-object-control="read"]')).toBeFocused();
  });

  test("direct object return pushes the room route and restores its semantic link", async ({
    page,
  }) => {
    await page.goto("/play/read", { waitUntil: "networkidle" });
    await expect(page.getByRole("dialog", { name: "Interactive room" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/play$/);
    const readLink = page.locator(
      '[data-room-overview] [data-room-object-link="read"]',
    );
    await expect(readLink).toBeFocused();

    await page.goBack({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/play\/read$/);
    await expect(page.getByRole("heading", { name: "Borrowed Shelf" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Interactive room" })).toHaveCount(0);
  });

  test("a directly loaded object route stays semantic and does not initialize the room", async ({
    page,
  }) => {
    await page.goto("/play/read", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Borrowed Shelf" })).toBeVisible();
    await expect(page.locator("main[data-room-screen]")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "Interactive room" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to room" })).toBeVisible();
  });

  test("Spotify remains consent-gated on the Listen object route", async ({ page }) => {
    const embedRequests = [];
    await page.route("**/api/connectors/spotify", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify(spotifyFixture()),
      });
    });
    await page.route("https://open.spotify.com/embed/**", async (route) => {
      embedRequests.push(route.request().url());
      await route.fulfill({
        contentType: "text/html",
        status: 200,
        body: "<!doctype html><title>Spotify fixture</title>",
      });
    });

    await page.goto("/play/listen", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Top Tracks, in returned order." })).toBeVisible();
    expect(embedRequests).toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);

    const listenHere = page.getByRole("button", { name: "Listen here" }).first();
    await listenHere.click();
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(embedRequests).toEqual([]);
    await page.getByRole("button", { name: "Load Spotify player" }).click();
    await expect(page.locator('iframe[title*="Spotify"]')).toHaveCount(1);
    expect(embedRequests).toHaveLength(1);
    await page.getByRole("button", { name: "Close player" }).click();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(listenHere).toBeFocused();
  });

  test("Strava remains consent-gated on the Move object route", async ({ page }) => {
    const embedRequests = [];
    await page.route("**/api/connectors/strava", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify(stravaFixture()),
      });
    });
    await page.route("https://www.strava.com/athletes/**", async (route) => {
      embedRequests.push(route.request().url());
      await route.fulfill({
        contentType: "text/html",
        status: 200,
        body: "<!doctype html><title>Strava fixture</title>",
      });
    });

    await page.goto("/play/move", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Load public Strava feed" })).toBeVisible();
    expect(embedRequests).toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);

    await page.getByRole("button", { name: "Load public Strava feed" }).click();
    await expect(page.locator('iframe[title*="Strava"]')).toHaveCount(1);
    expect(embedRequests).toHaveLength(1);
  });

  for (const width of widths) {
    test(`all object routes fit a ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      for (const route of directRoutes) {
        const response = await page.goto(route, { waitUntil: "networkidle" });
        expect(response?.status(), route).toBe(200);
        const overflow = await overflowReport(page);
        expect(
          overflow.offenders,
          `${route}: ${JSON.stringify(overflow.offenders)}`,
        ).toEqual([]);
        expect(overflow.documentWidth).toBeLessThanOrEqual(width + 1);
      }
    });
  }

  for (const route of directRoutes) {
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

  test("all six object foundations remain available without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    for (const object of objects) {
      const response = await page.goto(`/play/${object.id}`, { waitUntil: "load" });
      expect(response?.status(), object.id).toBe(200);
      await expect(page.getByRole("heading", { name: object.title })).toBeVisible();
      await expect(page.locator("main[data-room-screen]")).toHaveCount(1);
      await expect(page.locator("iframe, canvas")).toHaveCount(0);
    }
    await context.close();
  });

  for (const capability of ["mobile", "reduced-motion", "forced-colors", "save-data"]) {
    test(`${capability} keeps the static room and never requests the 3D runtime`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport:
          capability === "mobile"
            ? { width: 390, height: 844 }
            : { width: 1440, height: 900 },
        reducedMotion: capability === "reduced-motion" ? "reduce" : "no-preference",
        forcedColors: capability === "forced-colors" ? "active" : "none",
      });
      if (capability === "save-data") {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "connection", {
            configurable: true,
            value: { saveData: true },
          });
        });
      }
      const page = await context.newPage();
      const runtimeScripts = runtimeChunkRequests(page);
      await page.goto("/play", { waitUntil: "networkidle" });
      await expect(page.locator('[data-room-overview] a[href^="/play/"]')).toHaveCount(6);
      await expect(page.getByRole("button", { name: "Enter the room" })).toHaveCount(0);
      await expect(page.locator("canvas")).toHaveCount(0);
      expect(runtimeScripts).toEqual([]);
      await context.close();
    });
  }
});
