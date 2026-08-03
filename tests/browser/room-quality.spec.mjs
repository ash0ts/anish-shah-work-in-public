import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const roomMode = process.env.BROWSER_PLAY_MODE === "room";
const objects = [
  {
    id: "watch",
    label: "Watch",
    provider: "myanimelist",
    foundation: "MyAnimeList public signal",
    title: "Midnight Broadcast",
  },
  {
    id: "read",
    label: "Read",
    provider: "hardcover",
    foundation: "Hardcover · Personal circulation desk",
    title: "Borrowed Shelf",
  },
  {
    id: "listen",
    label: "Listen",
    provider: "spotify",
    foundation: "Spotify · One returned order at a time",
    title: "Pocket Player",
  },
  {
    id: "collect",
    label: "Collect",
    provider: "discogs",
    foundation: "Discogs · Physical collection",
    title: "Crate Archive",
  },
  {
    id: "play",
    label: "Play",
    provider: "steam",
    foundation: "Steam · Public library snapshot",
    title: "Desktop Library",
  },
  {
    id: "move",
    label: "Move",
    provider: "strava",
    foundation: "Strava · Consent-gated public feed",
    title: "Cardio Television",
  },
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

async function settlePaint(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

async function findInteractiveRoomPoint(page) {
  const stage = page.locator("[data-room-poster-stage]");
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The interactive room has no visible stage.");

  for (let row = 2; row <= 9; row += 1) {
    for (let column = 1; column <= 15; column += 1) {
      const x = bounds.x + (bounds.width * column) / 16;
      const y = bounds.y + (bounds.height * row) / 11;
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
      const id = await stage.getAttribute("data-room-hovered-object");
      if (id) return { id, x, y };
    }
  }

  throw new Error("No procedural room object responded to a real pointer ray.");
}

async function activeElementReport(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    const runtime = document.querySelector("[data-room-runtime]");
    const watch = document.querySelector('[data-room-object-control="watch"]');
    if (!(element instanceof HTMLElement)) return null;
    return {
      tag: element.tagName.toLowerCase(),
      text: element.textContent?.trim().slice(0, 80) ?? "",
      roomControl: element.dataset.roomObjectControl ?? null,
      roomLink: element.dataset.roomObjectLink ?? null,
      className: element.className,
      runtimeInert: runtime?.hasAttribute("inert") ?? null,
      runtimeAriaHidden: runtime?.getAttribute("aria-hidden") ?? null,
      runtimePresenting: runtime?.getAttribute("data-presenting") ?? null,
      watchInsideInert: Boolean(watch?.closest("[inert]")),
    };
  });
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

  test("non-Play routes never request the room renderer", async ({ page }) => {
    const runtimeScripts = runtimeChunkRequests(page);
    for (const route of ["/", "/work", "/sources", "/privacy"]) {
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status(), route).toBe(200);
    }
    expect(runtimeScripts).toEqual([]);
  });

  test("the first-party room poster remains visible across both deferred room boundaries", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let releaseRoomRuntime;
    const roomRuntimeReleased = new Promise((resolve) => {
      releaseRoomRuntime = resolve;
    });
    let releaseRoomStage;
    const roomStageReleased = new Promise((resolve) => {
      releaseRoomStage = resolve;
    });
    let runtimeIntercepted = false;
    let stageIntercepted = false;
    await page.route(/\/assets\/RoomRuntime-[^/]+\.js(?:\?.*)?$/, async (route) => {
      runtimeIntercepted = true;
      await roomRuntimeReleased;
      await route.continue();
    });
    await page.route(/\/assets\/RoomStage-[^/]+\.js(?:\?.*)?$/, async (route) => {
      stageIntercepted = true;
      await roomStageReleased;
      await route.continue();
    });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter the room" }).click();
    await expect(page.getByRole("dialog", { name: "Interactive room" })).toBeVisible();
    await expect(
      page.locator('[data-room-runtime-loading] img[src*="my-room-2001-neutral"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-room-runtime-loading] button', { hasText: "Leave room" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.locator('[data-room-runtime-loading] button', { hasText: "Leave room" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.locator('[data-room-runtime-loading] button', { hasText: "Leave room" }),
    ).toBeFocused();
    expect(runtimeIntercepted).toBe(true);
    releaseRoomRuntime();
    await expect(
      page.locator('[data-room-runtime] img[src*="my-room-2001-neutral"]'),
    ).toBeVisible();
    expect(stageIntercepted).toBe(true);
    releaseRoomStage();
    await expect(page.getByText("Room ready")).toBeVisible();
    await expect(
      page.locator('[data-room-runtime] img[src*="my-room-2001-neutral"]'),
    ).toHaveCount(0);
  });

  test("direct routes render the selected provider foundation without unrelated browser reads", async ({ page }) => {
    const requests = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/connectors/")) requests.push(pathname);
    });

    for (const object of objects) {
      requests.length = 0;
      await page.goto(`/play/${object.id}`, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: object.title })).toBeVisible();
      await expect(page.getByText(object.foundation, { exact: false })).toBeVisible();
      expect(requests).toEqual([]);
    }
  });

  test("an explicit preview scenario survives semantic and room navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play?fixture=long-title", { waitUntil: "networkidle" });
    const readLink = page.locator('[data-room-object-link="read"]');
    await expect(readLink).toHaveAttribute(
      "href",
      "/play/read?fixture=long-title",
    );

    await page.getByRole("button", { name: "Enter the room" }).click();
    const room = page.getByRole("dialog", { name: "Interactive room" });
    await room.locator('[data-room-object-control="read"]').click();
    await expect(page).toHaveURL(/\/play\/read\?fixture=long-title$/);
    await page.getByRole("searchbox", { name: "Find a title" }).fill("記憶");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText(/記憶と機械/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to room" })).toHaveAttribute(
      "href",
      "/play?fixture=long-title",
    );

    await page.goto(
      "/play/collect?fixture=maximum-density&pageSize=12",
      { waitUntil: "domcontentloaded" },
    );
    await page.getByRole("button", { name: "Gallery" }).click();
    await expect(page.locator('input[name="fixture"]')).toHaveValue(
      "maximum-density",
    );
    const nextHref = await page
      .getByRole("link", { name: "Next" })
      .getAttribute("href");
    expect(nextHref).not.toBeNull();
    expect(
      new URL(nextHref, "http://preview.test").searchParams.get("fixture"),
    ).toBe("maximum-density");
  });

  test("Enter traps focus and Leave restores the invoking control", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    const originalOverflow = await page.locator("html").evaluate(
      (element) => element.style.overflow,
    );
    const enter = page.getByRole("button", { name: "Enter the room" });
    await expect(enter).toBeVisible();
    await enter.click();

    const room = page.getByRole("dialog", { name: "Interactive room" });
    const leave = room.getByRole("button", { name: "Leave room" });
    const lastObject = room.locator('[data-room-object-control="move"]');
    await expect(room).toBeVisible();
    await expect(leave).toBeFocused();
    await expect(room.locator("canvas")).toHaveAttribute("aria-hidden", "true");
    await expect(room.locator("canvas")).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("body > header")).toHaveAttribute("inert", "");
    await expect(page.locator("body > .skip-link")).toHaveAttribute("inert", "");
    await expect(page.locator("body > .site-frame > footer")).toHaveAttribute(
      "inert",
      "",
    );
    await expect(page.locator("[data-room-overview]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      await page.locator("html").evaluate((element) => element.style.overflow),
    ).toBe("hidden");
    await expect(room.locator("[data-room-runtime-announcer]")).toContainText(
      "Interactive room opened.",
    );
    await leave.press("Tab");
    const firstViewControl = room.getByRole("button", { name: "Turn left" });
    await expect(firstViewControl).toBeFocused();
    await page.waitForTimeout(300);
    await expect(firstViewControl).toBeFocused();
    const roomBounds = await room.boundingBox();
    expect(roomBounds).not.toBeNull();
    expect(roomBounds.x).toBeLessThanOrEqual(1);
    expect(roomBounds.y).toBeLessThanOrEqual(1);
    expect(roomBounds.width).toBeGreaterThanOrEqual(1439);
    expect(roomBounds.height).toBeGreaterThanOrEqual(899);

    await lastObject.focus();
    await expect(room.locator("[data-room-object-cue]")).toContainText(
      "Cardio televisionMove",
    );
    await expect(lastObject).toHaveAttribute("data-focused", "true");
    await lastObject.press("Tab");
    await expect(leave).toBeFocused();
    await leave.press("Shift+Tab");
    await expect(lastObject).toBeFocused();
    await page.locator("body > header a").first().evaluate((element) => {
      element.focus();
    });
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest("[data-room-runtime]")),
      ),
    ).toBe(true);

    const turnLeft = room.getByRole("button", { name: "Turn left" });
    await turnLeft.click();
    await turnLeft.click();
    await turnLeft.click();
    await expect(turnLeft).toBeDisabled();
    await expect(turnLeft).toHaveAttribute("aria-disabled", "true");
    const turnRight = room.getByRole("button", { name: "Turn right" });
    for (let index = 0; index < 6; index += 1) await turnRight.click();
    await expect(turnRight).toBeDisabled();
    const tiltUp = room.getByRole("button", { name: "Tilt up" });
    await tiltUp.click();
    await tiltUp.click();
    await expect(tiltUp).toBeDisabled();
    const tiltDown = room.getByRole("button", { name: "Tilt down" });
    for (let index = 0; index < 4; index += 1) await tiltDown.click();
    await expect(tiltDown).toBeDisabled();
    await room.getByRole("button", { name: "Reset view" }).click();
    await expect(turnLeft).toBeEnabled();
    await expect(turnRight).toBeEnabled();
    await expect(tiltUp).toBeEnabled();
    await expect(tiltDown).toBeEnabled();

    const activeRoomAxe = await new AxeBuilder({ page })
      .include("[data-room-runtime]")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      activeRoomAxe.violations.filter(({ impact }) =>
        ["serious", "critical"].includes(impact),
      ),
    ).toEqual([]);

    await leave.click();
    await expect(room).toHaveCount(0);
    await expect(enter).toBeFocused();
    await expect(page.locator("body > header")).not.toHaveAttribute("inert", "");
    await expect(page.locator("body > .skip-link")).not.toHaveAttribute(
      "inert",
      "",
    );
    await expect(page.locator("body > .site-frame > footer")).not.toHaveAttribute(
      "inert",
      "",
    );
    await expect(page.locator("[data-room-overview]")).not.toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      await page.locator("html").evaluate((element) => element.style.overflow),
    ).toBe(originalOverflow);

    await enter.click();
    await expect(page.getByRole("dialog", { name: "Interactive room" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Interactive room" })).toHaveCount(0);
    await expect(enter).toBeFocused();
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
    const pixelRatio = await page.locator("canvas").evaluate((canvas) => ({
      x: canvas.width / canvas.clientWidth,
      y: canvas.height / canvas.clientHeight,
    }));
    expect(pixelRatio.x).toBeLessThanOrEqual(1.26);
    expect(pixelRatio.y).toBeLessThanOrEqual(1.26);

    await page.waitForTimeout(250);
    const idleStart = await page.evaluate(() => window.__roomDrawMetrics.total);
    await page.waitForTimeout(500);
    const idleEnd = await page.evaluate(() => window.__roomDrawMetrics.total);
    expect(idleEnd).toBe(idleStart);
  });

  test("WebGL context loss permanently restores the static semantic room", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter the room" }).click();
    await expect(page.getByText("Room ready")).toBeVisible();
    await page.locator("canvas").evaluate((canvas) => {
      canvas.dispatchEvent(
        new Event("webglcontextlost", { bubbles: false, cancelable: true }),
      );
    });

    await expect(page.getByRole("dialog", { name: "Interactive room" })).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.locator("[data-room-overview]")).toBeVisible();
    await expect(page.locator("[data-room-overview]")).not.toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(page.locator("body > header")).not.toHaveAttribute("inert", "");
    await expect(
      page.locator('[data-room-overview] [data-room-object-link="watch"]'),
    ).toBeFocused();
    await expect(page.locator("[data-room-announcer]")).toContainText(
      "interactive room is unavailable",
    );
    await expect(page.getByRole("button", { name: "Enter the room" })).toHaveCount(0);
  });

  test("twenty real drags never open an object and twenty real clicks open the hit object", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter the room" }).click();
    await expect(page.getByText("Room ready")).toBeVisible();
    const point = await findInteractiveRoomPoint(page);
    const room = page.getByRole("dialog", { name: "Interactive room" });

    for (let index = 0; index < 20; index += 1) {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 12, point.y + (index % 2 ? 2 : -2));
      await page.mouse.up();
      await expect(page).toHaveURL(/\/play$/);
      await room.getByRole("button", { name: "Reset view" }).click();
      await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
    }

    for (let index = 0; index < 20; index += 1) {
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(25);
      await expect(page.locator("[data-room-poster-stage]")).toHaveAttribute(
        "data-room-hovered-object",
        point.id,
      );
      await page.mouse.down();
      await page.waitForTimeout(20);
      await page.mouse.up();
      await expect(page).toHaveURL(new RegExp(`/play/${point.id}$`), {
        timeout: 10_000,
      });
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/play$/, { timeout: 10_000 });
      await expect(room).toBeVisible();
      await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
      await expect(
        page.locator(`[data-room-object-control="${point.id}"]`),
      ).toBeFocused();
    }
  });

  test("room-originated Back and Escape use browser history and restore exact focus", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter the room" }).click();
    let room = page.getByRole("dialog", { name: "Interactive room" });
    await room.locator('[data-room-object-control="watch"]').click();
    await expect(page).toHaveURL(/\/play\/watch$/);
    await expect(page.locator("[data-room-screen-entry-focus]")).toBeFocused();
    await expect(page.locator("[data-room-announcer]")).toContainText(
      "Opened Watch: Midnight Broadcast.",
    );

    await page.getByRole("link", { name: "Back to room" }).click();
    await expect(page).toHaveURL(/\/play$/);
    room = page.getByRole("dialog", { name: "Interactive room" });
    await expect(room).toBeVisible();
    await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
    await expect(
      room.locator('[data-room-object-control="watch"]'),
      JSON.stringify(await activeElementReport(page)),
    ).toBeFocused();
    await room.locator('[data-room-object-control="watch"]').press("Tab");
    await expect(room.locator('[data-room-object-control="read"]')).toBeFocused();
    await page.waitForTimeout(300);
    await expect(room.locator('[data-room-object-control="read"]')).toBeFocused();

    await page.goForward({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/play\/watch$/);
    await expect(page.locator("[data-room-screen-entry-focus]")).toBeFocused();
    await page.goBack({ waitUntil: "domcontentloaded" });
    room = page.getByRole("dialog", { name: "Interactive room" });
    await expect(room).toBeVisible();
    await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
    await expect(room.locator('[data-room-object-control="watch"]')).toBeFocused();

    for (const object of objects.filter(({ id }) => id !== "watch")) {
      await room.locator(`[data-room-object-control="${object.id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/play/${object.id}$`), {
        timeout: 10_000,
      });
      await expect(page.locator("[data-room-screen-entry-focus]")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/play$/, { timeout: 10_000 });
      room = page.getByRole("dialog", { name: "Interactive room" });
      await expect(room).toBeVisible();
      await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
      await expect(
        room.locator(`[data-room-object-control="${object.id}"]`),
      ).toBeFocused();
    }
  });

  test("direct object return pushes the room route and restores each semantic link", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    for (const object of objects) {
      await page.goto(`/play/${object.id}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: object.title })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Interactive room" })).toHaveCount(0);
      await expect(page.locator("[data-room-announcer]")).toContainText(
        `Opened ${object.label}: ${object.title}.`,
      );
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/play$/, { timeout: 10_000 });
      const semanticLink = page.locator(
        `[data-room-overview] [data-room-object-link="${object.id}"]`,
      );
      await expect(semanticLink).toBeFocused();

      await page.goBack({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`/play/${object.id}$`));
      await expect(page.getByRole("heading", { name: object.title })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Interactive room" })).toHaveCount(0);
    }
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

  test("a newer object selection cancels an in-flight room transition", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter the room" }).click();
    const room = page.getByRole("dialog", { name: "Interactive room" });
    await expect(room).toBeVisible();
    await room.locator('[data-room-object-control="watch"]').click();
    await room.locator('[data-room-object-control="play"]').click();
    await expect(page).toHaveURL(/\/play\/play$/);
    await expect(page.getByRole("heading", { name: "Desktop Library" })).toBeVisible();
    await expect(page.locator("[data-room-screen-entry-focus]")).toBeFocused();
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

  for (const width of widths) {
    test(`all object routes fit a ${width}px viewport`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      for (const object of objects) {
        const route = `/play/${object.id}`;
        const response = await page.goto(route, {
          waitUntil: "domcontentloaded",
        });
        expect(response?.status(), route).toBe(200);
        await expect(
          page.getByRole("heading", { name: object.title }),
        ).toBeVisible();
        await settlePaint(page);
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

    for (const object of objects) {
      const response = await page.goto(`/play/${object.id}`, { waitUntil: "load" });
      expect(response?.status(), object.id).toBe(200);
      await expect(page.getByRole("heading", { name: object.title })).toBeVisible();
      await expect(page.getByText(object.foundation, { exact: false }).first()).toBeVisible();
      await expect(page.locator("main[data-room-screen]")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Back to room" })).toBeVisible();
      await expect(page.locator("iframe, canvas")).toHaveCount(0);
    }
    await context.close();
  });

  for (const capability of [
    "mobile",
    "coarse-pointer",
    "reduced-motion",
    "forced-colors",
    "save-data",
    "zoom-200",
    "zoom-400",
    "webgl2-unavailable",
  ]) {
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
      if (capability === "coarse-pointer") {
        await context.addInitScript(() => {
          const nativeMatchMedia = window.matchMedia.bind(window);
          window.matchMedia = (query) => {
            if (query !== "(pointer: fine)") return nativeMatchMedia(query);
            return {
              matches: false,
              media: query,
              onchange: null,
              addEventListener() {},
              addListener() {},
              dispatchEvent: () => true,
              removeEventListener() {},
              removeListener() {},
            };
          };
        });
      }
      if (capability === "zoom-200" || capability === "zoom-400") {
        await context.addInitScript((scale) => {
          if (!window.visualViewport) return;
          Object.defineProperty(window.visualViewport, "scale", {
            configurable: true,
            get: () => scale,
          });
        }, capability === "zoom-200" ? 2 : 4);
      }
      if (capability === "webgl2-unavailable") {
        await context.addInitScript(() => {
          const nativeGetContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...options) {
            if (type === "webgl2") return null;
            return nativeGetContext.call(this, type, ...options);
          };
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
