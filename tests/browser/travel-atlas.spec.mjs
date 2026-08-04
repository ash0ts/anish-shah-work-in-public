import { expect, test } from "@playwright/test";

const roomMode = process.env.BROWSER_PLAY_MODE === "room";
const widths = [320, 390, 768, 1024, 1440, 1920];

async function afterTwoFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function afterOneFrame(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
}

async function instrumentTravelGlobeDrawMetrics(page) {
  await page.addInitScript(() => {
    const metrics = {
      currentFrame: 0,
      currentTriangles: 0,
      maximumFrame: 0,
      maximumTriangles: 0,
      total: 0,
    };
    Object.defineProperty(window, "__travelGlobeDrawMetrics", {
      configurable: false,
      value: metrics,
    });

    for (const contextName of [
      "WebGL2RenderingContext",
      "WebGLRenderingContext",
    ]) {
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
          const mode = args[0];
          const count = method.startsWith("drawArrays") ? args[2] : args[1];
          const instances = method.endsWith("Instanced")
            ? args[method.startsWith("drawArrays") ? 3 : 4]
            : 1;
          const primitiveTriangles =
            mode === 0x0004
              ? Math.floor(count / 3)
              : mode === 0x0005 || mode === 0x0006
                ? Math.max(0, count - 2)
                : 0;
          metrics.currentTriangles += primitiveTriangles * instances;
          return original.apply(this, args);
        };
      }
    }

    let measuredFrame = null;
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      nativeRequestAnimationFrame((time) => {
        if (measuredFrame !== time) {
          measuredFrame = time;
          metrics.currentFrame = 0;
          metrics.currentTriangles = 0;
        }
        try {
          callback(time);
        } finally {
          metrics.maximumFrame = Math.max(
            metrics.maximumFrame,
            metrics.currentFrame,
          );
          metrics.maximumTriangles = Math.max(
            metrics.maximumTriangles,
            metrics.currentTriangles,
          );
        }
      });
  });
}

async function clearTravelPinHover(page, stage, bounds) {
  const viewport = page.viewportSize();
  const outsideCandidates = [
    { x: 1, y: 1 },
    { x: Math.max(1, (viewport?.width ?? 2) - 2), y: 1 },
    { x: 1, y: Math.max(1, (viewport?.height ?? 2) - 2) },
  ];
  const outside = outsideCandidates.find(
    ({ x, y }) =>
      x < bounds.x ||
      x > bounds.x + bounds.width ||
      y < bounds.y ||
      y > bounds.y + bounds.height,
  );
  if (!outside) throw new Error("The travel globe fills the pointer viewport.");
  await page.mouse.move(outside.x, outside.y);
  await afterTwoFrames(page);
  await expect
    .poll(() => stage.getAttribute("data-travel-globe-hovered-place"), {
      timeout: 2_000,
    })
    .toBeNull();
}

async function findRoomObjectPoint(page, targetId) {
  const stage = page.locator("[data-room-poster-stage]");
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The room has no visible pointer stage.");
  const anchor = targetId === "travel" ? { x: 0.64, y: 0.48 } : { x: 0.5, y: 0.5 };
  const candidates = [];
  const seenPoints = new Set();
  const addCandidate = (xRatio, yRatio) => {
    if (xRatio <= 0 || xRatio >= 1 || yRatio <= 0 || yRatio >= 1) return;
    const key = `${xRatio.toFixed(4)}:${yRatio.toFixed(4)}`;
    if (seenPoints.has(key)) return;
    seenPoints.add(key);
    candidates.push({ xRatio, yRatio });
  };

  // Probe the reviewed neutral projection first. The neighborhood absorbs the
  // small authored room rotation produced by the drag half of this test.
  for (const radius of [0, 0.025, 0.05, 0.075]) {
    if (radius === 0) {
      addCandidate(anchor.x, anchor.y);
      continue;
    }
    for (const [xOffset, yOffset] of [
      [-radius, 0],
      [radius, 0],
      [0, -radius],
      [0, radius],
      [-radius, -radius],
      [radius, -radius],
      [-radius, radius],
      [radius, radius],
    ]) {
      addCandidate(anchor.x + xOffset, anchor.y + yOffset);
    }
  }

  // Keep one general fallback, but bound it in both probe count and wall time.
  // Sorting by the object anchor finds nearby live ray hits before exploring
  // the rest of the room under slower traced/CI rendering.
  const fallback = [];
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      const xRatio = (column + 0.5) / 12;
      const yRatio = (row + 0.5) / 8;
      fallback.push({
        xRatio,
        yRatio,
        distance: Math.hypot(xRatio - anchor.x, yRatio - anchor.y),
      });
    }
  }
  fallback
    .sort((left, right) => left.distance - right.distance)
    .forEach(({ xRatio, yRatio }) => addCandidate(xRatio, yRatio));

  const startedAt = Date.now();
  const deadlineMs = 12_000;
  const observedIds = new Set();
  let probes = 0;
  for (const { xRatio, yRatio } of candidates) {
    if (Date.now() - startedAt >= deadlineMs) break;
    const point = {
      x: bounds.x + bounds.width * xRatio,
      y: bounds.y + bounds.height * yRatio,
    };
    probes += 1;
    await page.mouse.move(point.x, point.y);
    await afterOneFrame(page);
    const observed = await stage.getAttribute("data-room-hovered-object");
    if (observed) observedIds.add(observed);
    if (observed !== targetId) continue;

    // Confirm that the current coordinate—not a prior queued hover—owns the
    // real R3F ray before returning it to the click/drag acceptance flow.
    await afterTwoFrames(page);
    if ((await stage.getAttribute("data-room-hovered-object")) === targetId) {
      return point;
    }
  }
  throw new Error(
    `The ${targetId} room object had no confirmed real pointer hit after ${probes} probes (${[...observedIds].join(", ") || "none observed"}).`,
  );
}

async function findTravelPinPoint(page, targetId) {
  const stage = page.locator("[data-travel-globe-canvas]");
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The travel globe has no visible pointer stage.");
  const size = Math.min(bounds.width, bounds.height);
  const radius = size * 0.28;
  const step = Math.max(6, Math.floor(size / 55));
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };

  await clearTravelPinHover(page, stage, bounds);

  for (let yOffset = -radius; yOffset <= radius; yOffset += step) {
    const row = Math.round((yOffset + radius) / step);
    const columns = [];
    for (let xOffset = -radius; xOffset <= radius; xOffset += step) {
      columns.push(xOffset);
    }
    if (row % 2 === 1) columns.reverse();
    for (const xOffset of columns) {
      const point = { x: center.x + xOffset, y: center.y + yOffset };
      await page.mouse.move(point.x, point.y);
      await afterTwoFrames(page);
      if (
        (await stage.getAttribute("data-travel-globe-hovered-place")) ===
        targetId
      ) {
        return point;
      }
    }
  }
  throw new Error(`The ${targetId} travel pin has no real Canvas raycast hit.`);
}

async function settleTravelPinPoint(page, targetId, origin) {
  const stage = page.locator("[data-travel-globe-canvas]");
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The travel globe has no visible pointer stage.");
  const withinStage =
    origin.x >= bounds.x + 1 &&
    origin.x <= bounds.x + bounds.width - 1 &&
    origin.y >= bounds.y + 1 &&
    origin.y <= bounds.y + bounds.height - 1;
  if (!withinStage) return findTravelPinPoint(page, targetId);

  try {
    await expect
      .poll(
        async () => {
          await page.mouse.move(origin.x, origin.y);
          await afterTwoFrames(page);
          return stage.getAttribute("data-travel-globe-hovered-place");
        },
        { intervals: [50, 100, 150], timeout: 3_000 },
      )
      .toBe(targetId);
    return origin;
  } catch {
    return findTravelPinPoint(page, targetId);
  }
}

async function installCapabilityOverride(page, reason) {
  await page.addInitScript((override) => {
    if (override === "save-data") {
      Object.defineProperty(navigator, "connection", {
        configurable: true,
        value: { saveData: true },
      });
    }
    if (
      (override === "zoom-200" || override === "zoom-400") &&
      window.visualViewport
    ) {
      Object.defineProperty(window.visualViewport, "scale", {
        configurable: true,
        get: () => (override === "zoom-200" ? 2 : 4),
      });
    }
    if (override === "forced-colors") {
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = nativeMatchMedia(query);
        if (query !== "(forced-colors: active)") return result;
        return new Proxy(result, {
          get(target, property) {
            if (property === "matches") return true;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      };
    }
    if (override === "webgl2-unavailable") {
      const nativeGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...parameters) {
        if (kind === "webgl2") return null;
        return nativeGetContext.call(this, kind, ...parameters);
      };
    }
  }, reason);
}

async function settleMatchCut(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("[data-match-cut-state]")?.getAttribute(
        "data-match-cut-state",
      ) === "settled",
  );
}

function travelRequests(page) {
  const urls = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.startsWith("/api/travel") ||
      pathname.startsWith("/api/travel-media") ||
      pathname.startsWith("/assets/travel/geography/")
    ) {
      urls.push(pathname);
    }
  });
  return urls;
}

test.describe("Postcard Planet", () => {
  test.skip(!roomMode, "Travel is exercised in the My Room browser matrix.");

  test("the room advertises seven objects without reading Travel data", async ({
    page,
  }) => {
    const requests = travelRequests(page);
    const travelStageScripts = [];
    page.on("request", (request) => {
      if (
        request.resourceType() === "script" &&
        /TravelGlobeStage|travel-globe/i.test(new URL(request.url()).pathname)
      ) {
        travelStageScripts.push(request.url());
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });

    await expect(page.locator("[data-room-object-link]")).toHaveCount(7);
    await expect(
      page.locator('[data-room-object-link="travel"]'),
    ).toHaveAttribute("href", "/play/travel");
    expect(requests).toEqual([]);
    expect(travelStageScripts).toEqual([]);

    await page.getByRole("button", { name: "Enter the room" }).click();
    await expect(page.getByText("Room ready", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('[data-room-object-control="travel"]'),
    ).toBeVisible();
    expect(requests).toEqual([]);
    expect(travelStageScripts).toEqual([]);
  });

  test("the real room globe drags safely and clicks through to Travel", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter the room" }).click();
    await expect(page.getByText("Room ready", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const point = await findRoomObjectPoint(page, "travel");
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 14, point.y + 2);
    await page.mouse.up();
    await expect(page).toHaveURL(/\/play$/);
    await page.getByRole("button", { name: "Reset view" }).click();
    await afterTwoFrames(page);

    const refreshedPoint = await findRoomObjectPoint(page, "travel");
    await page.mouse.click(refreshedPoint.x, refreshedPoint.y);
    await expect(page).toHaveURL(/\/play\/travel$/, { timeout: 10_000 });
  });

  test("country, region, place, and trip navigation stays synchronized", async ({
    page,
  }) => {
    const requests = travelRequests(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play/travel", { waitUntil: "networkidle" });
    await settleMatchCut(page);

    await expect(
      page.getByRole("heading", { name: "Postcard Planet", exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-travel-trip]")).toHaveCount(2);
    await expect(page.locator("[data-travel-globe-canvas]")).toHaveCount(1);
    await expect(page.locator('[data-globe-ready="true"]')).toHaveCount(1, {
      timeout: 10_000,
    });
    expect(
      requests.some((pathname) =>
        pathname.startsWith("/assets/travel/geography/manifest."),
      ),
    ).toBe(true);
    await expect
      .poll(
        () =>
          requests.some((pathname) =>
            /country-id\.[a-f0-9]+\.png$/.test(pathname),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    await expect(page.locator('[data-travel-country="US"]')).toContainText(
      "0 trips",
    );
    const search = page.getByLabel("Find a country");
    await search.fill("not-a-public-country");
    await expect(
      page.getByRole("status").filter({ hasText: "0 countries" }),
    ).toBeVisible();
    await expect(page.getByText("No countries match that search.")).toBeVisible();
    await search.fill("");

    const country = page.locator('[data-travel-country="JP"]');
    await country.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Japan", exact: true })).toBeVisible();
    await expect(page.locator("[data-travel-atlas-back]")).toBeFocused();

    const place = page.locator('[data-travel-place="place_preview_tokyo"]');
    await place.focus();
    await page.keyboard.press("Enter");
    await expect(place).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-travel-place-inspector]")).toContainText(
      "Tokyo",
    );
    await expect(
      page.locator("[data-travel-place-inspector]").getByRole("link"),
    ).toHaveAttribute(
      "href",
      "/play/travel/trips/tokyo-after-midnight-preview",
    );
    await expect(page.locator("[data-travel-trip]")).toHaveCount(1);

    const back = page.locator("[data-travel-atlas-back]");
    await back.click();
    await expect(place).toHaveAttribute("aria-pressed", "false");
    await back.click();
    await expect(page.getByRole("heading", { name: "World", exact: true })).toBeVisible();
    await expect(back).toBeDisabled();
    await expect(search).toBeFocused();

    const tripLink = page
      .locator('[data-travel-trip="tokyo-after-midnight-preview"]')
      .getByRole("link", { name: /Open trip log/ });
    await tripLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/play\/travel\/trips\/tokyo-after-midnight-preview$/);
    await expect(
      page.getByRole("heading", { name: /Tokyo after midnight/ }),
    ).toBeVisible();
    const pageSizes = page.getByRole("navigation", { name: "Photos per page" });
    await expect(pageSizes.getByText("12", { exact: true })).toBeVisible();
    await expect(pageSizes.getByRole("link", { name: "24" })).toBeVisible();
    await expect(pageSizes.getByRole("link", { name: "36" })).toBeVisible();
  });

  for (const viewport of [
    { label: "wide", width: 1440, height: 900, zoomSteps: 0 },
    { label: "compact zoomed", width: 1024, height: 860, zoomSteps: 2 },
  ]) {
    test(`a real Canvas raycast selects a pin at ${viewport.label} scale`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.goto("/play/travel", { waitUntil: "networkidle" });
      await settleMatchCut(page);
      await expect(page.locator('[data-globe-ready="true"]')).toHaveCount(1, {
        timeout: 10_000,
      });
      await page.locator('[data-travel-country="JP"]').click();
      for (let index = 0; index < viewport.zoomSteps; index += 1) {
        await page.getByRole("button", { name: "Zoom globe in" }).click();
      }
      await page.waitForTimeout(900);
      const point = await findTravelPinPoint(page, "place_preview_tokyo");
      await page.mouse.click(point.x, point.y);
      await expect(page.locator("[data-travel-place-inspector]")).toHaveAttribute(
        "data-travel-place-inspector",
        "place_preview_tokyo",
      );
    });
  }

  test("twenty real Canvas pin clicks and twenty pin-origin drags stay bounded", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play/travel", { waitUntil: "networkidle" });
    await settleMatchCut(page);
    await expect(page.locator('[data-globe-ready="true"]')).toHaveCount(1, {
      timeout: 10_000,
    });
    await page.locator('[data-travel-country="JP"]').click();
    const place = page.locator('[data-travel-place="place_preview_tokyo"]');
    const back = page.locator("[data-travel-atlas-back]");
    const inspector = page.locator("[data-travel-place-inspector]");

    // Establish a close country view without selecting the semantic place.
    // Every place selection below therefore originates from a true R3F hit.
    for (let index = 0; index < 4; index += 1) {
      await page.getByRole("button", { name: "Zoom globe in" }).click();
    }
    await page.waitForTimeout(700);
    let pin = await findTravelPinPoint(page, "place_preview_tokyo");

    for (let index = 0; index < 20; index += 1) {
      pin = await settleTravelPinPoint(page, "place_preview_tokyo", pin);
      // Do not add a synthetic click delay: R3F correctly requires the same
      // projected object at pointer-down and pointer-up.
      await page.mouse.click(pin.x, pin.y);
      await expect(
        inspector,
        `Canvas click ${index + 1} should select Tokyo`,
      ).toHaveAttribute(
        "data-travel-place-inspector",
        "place_preview_tokyo",
      );
      await expect(place).toHaveAttribute("aria-pressed", "true");
      await back.click();
      await expect(inspector).toHaveCount(0);
      await expect(place).toHaveAttribute("aria-pressed", "false");
      await page.waitForTimeout(450);
    }

    for (let index = 0; index < 20; index += 1) {
      pin = await settleTravelPinPoint(page, "place_preview_tokyo", pin);
      await page.mouse.down();
      await page.mouse.move(pin.x + 12, pin.y + (index % 2 ? 2 : -2));
      await page.mouse.up();
      await expect(page).toHaveURL(/\/play\/travel$/);
      await expect(inspector).toHaveCount(0);
      await expect(place).toHaveAttribute("aria-pressed", "false");
      await expect(
        page.getByRole("heading", { name: "Japan", exact: true }),
      ).toBeVisible();

      // Reset the authored camera target without mutating or opening a trip.
      await page.getByRole("button", { name: "World", exact: true }).click();
      await page.locator('[data-travel-country="JP"]').click();
      await page.waitForTimeout(450);
    }
  });

  test("a nested trip preserves the room-origin return path", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter the room" }).click();
    await expect(page.getByText("Room ready", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const travelControl = page.locator('[data-room-object-control="travel"]');
    await travelControl.click();
    await expect(page).toHaveURL(/\/play\/travel$/);
    await settleMatchCut(page);

    const tripLink = page
      .locator('[data-travel-trip="tokyo-after-midnight-preview"]')
      .getByRole("link", { name: /Open trip log/ });
    await tripLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      /\/play\/travel\/trips\/tokyo-after-midnight-preview$/,
    );
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/play$/);
    await expect(page.locator('[data-room-object-control="travel"]')).toBeFocused({
      timeout: 15_000,
    });
  });

  test("reduced motion and no-JavaScript retain the complete semantic atlas", async ({
    browser,
  }) => {
    const reduced = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 900 },
    });
    const reducedPage = await reduced.newPage();
    const deferredScripts = [];
    reducedPage.on("request", (request) => {
      if (
        request.resourceType() === "script" &&
        /TravelGlobeStage|Instances-/i.test(new URL(request.url()).pathname)
      ) {
        deferredScripts.push(request.url());
      }
    });
    await reducedPage.goto("/play/travel", { waitUntil: "networkidle" });
    await settleMatchCut(reducedPage);
    await expect(reducedPage.locator("[data-travel-static-atlas]")).toBeVisible();
    await expect(reducedPage.locator("[data-travel-globe-canvas]")).toHaveCount(0);
    await expect(reducedPage.getByRole("group", { name: "Globe zoom" })).toHaveCount(0);
    await expect(reducedPage.locator("[data-travel-trip]")).toHaveCount(2);
    expect(deferredScripts).toEqual([]);
    await reduced.close();

    const noJavaScript = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const noJavaScriptPage = await noJavaScript.newPage();
    const response = await noJavaScriptPage.goto("/play/travel", {
      waitUntil: "load",
    });
    expect(response?.status()).toBe(200);
    await expect(noJavaScriptPage.locator("canvas")).toHaveCount(0);
    await expect(noJavaScriptPage.locator("[data-travel-trip]")).toHaveCount(2);
    const textAtlas = noJavaScriptPage.locator("[data-travel-noscript-atlas]");
    await expect(textAtlas).toBeVisible();
    await expect(
      textAtlas.getByRole("navigation", { name: "Published travel countries" }),
    ).toBeVisible();
    await expect(
      textAtlas.getByRole("heading", { name: "Japan", exact: true }),
    ).toBeVisible();
    await expect(
      textAtlas.locator("strong").filter({ hasText: /^Tokyo$/ }),
    ).toBeVisible();
    await expect(
      textAtlas.getByRole("link", { name: "Tokyo after midnight" }),
    ).toHaveAttribute("href", "/play/travel/trips/tokyo-after-midnight-preview");
    await expect(
      noJavaScriptPage.getByRole("link", { name: /Open trip log/ }),
    ).toHaveCount(2);
    await noJavaScript.close();
  });

  for (const reason of [
    "forced-colors",
    "save-data",
    "zoom-200",
    "zoom-400",
    "webgl2-unavailable",
  ]) {
    test(`${reason} keeps the semantic atlas and skips the globe chunk`, async ({
      page,
    }) => {
      const globeScripts = [];
      await installCapabilityOverride(page, reason);
      page.on("request", (request) => {
        if (
          request.resourceType() === "script" &&
          /TravelGlobeStage|travel-globe/i.test(new URL(request.url()).pathname)
        ) {
          globeScripts.push(request.url());
        }
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/play/travel", { waitUntil: "networkidle" });
      await settleMatchCut(page);
      await expect(page.locator("[data-travel-static-atlas]")).toBeVisible();
      await expect(page.locator("[data-travel-globe-canvas]")).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Globe zoom" })).toHaveCount(0);
      await expect(page.locator("[data-travel-trip]")).toHaveCount(2);
      expect(globeScripts).toEqual([]);
    });
  }

  test("the globe stays within its render budget and stops rendering when idle", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await instrumentTravelGlobeDrawMetrics(page);
    await page.goto("/play/travel?fixture=completed", {
      waitUntil: "networkidle",
    });
    await settleMatchCut(page);
    await expect(page.locator('[data-globe-ready="true"]')).toHaveCount(1, {
      timeout: 10_000,
    });

    await page.locator('[data-travel-country="US"]').click();
    const region = page.locator('[data-travel-region="US-NY"]');
    await expect(region).toBeVisible();
    await region.click();
    await page.locator("[data-travel-place]").click();

    await page.waitForFunction(() => {
      const metrics = window.__travelGlobeDrawMetrics;
      return metrics.total > 0 && metrics.maximumTriangles > 0;
    });
    const metrics = await page.evaluate(() => window.__travelGlobeDrawMetrics);
    expect(metrics.maximumFrame).toBeLessThanOrEqual(8);
    expect(metrics.maximumTriangles).toBeLessThanOrEqual(60_000);

    await page.evaluate(() => {
      window.__travelGlobeIdleProbe = {
        changedAt: performance.now(),
        total: window.__travelGlobeDrawMetrics.total,
      };
    });
    await page.waitForFunction(() => {
      const probe = window.__travelGlobeIdleProbe;
      const total = window.__travelGlobeDrawMetrics.total;
      if (total !== probe.total) {
        probe.changedAt = performance.now();
        probe.total = total;
      }
      return performance.now() - probe.changedAt >= 350;
    });
    const idleStart = await page.evaluate(
      () => window.__travelGlobeDrawMetrics.total,
    );
    await page.waitForTimeout(500);
    const idleEnd = await page.evaluate(
      () => window.__travelGlobeDrawMetrics.total,
    );
    expect(idleEnd).toBe(idleStart);
  });

  test("a capable mobile viewport automatically enhances the readable atlas", async ({
    browser,
  }) => {
    const mobile = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    const page = await mobile.newPage();
    await page.goto("/play/travel", { waitUntil: "networkidle" });
    await settleMatchCut(page);
    await expect(page.locator("[data-travel-trip]")).toHaveCount(2);
    await expect(page.locator("[data-travel-globe-canvas]")).toHaveCount(1);
    await mobile.close();
  });

  test("WebGL context loss permanently returns to the semantic atlas", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play/travel", { waitUntil: "networkidle" });
    await settleMatchCut(page);
    const stage = page.locator("[data-travel-globe-canvas]");
    await expect(stage).toHaveCount(1);
    await expect(page.locator('[data-globe-ready="true"]')).toHaveCount(1, {
      timeout: 10_000,
    });
    await stage.locator("canvas").evaluate((element) => {
      const context = element.getContext("webgl2");
      const loseContext = context?.getExtension("WEBGL_lose_context");
      if (!loseContext) throw new Error("WEBGL_lose_context is unavailable.");
      loseContext.loseContext();
    });
    await expect(page.locator("[data-travel-globe-canvas]")).toHaveCount(0);
    await expect(page.locator("[data-travel-static-atlas]")).toBeVisible();
    await expect(page.getByRole("group", { name: "Globe zoom" })).toHaveCount(0);
    await expect(page.locator("[data-travel-trip]")).toHaveCount(2);
  });

  for (const width of widths) {
    test(`the atlas has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto("/play/travel", { waitUntil: "networkidle" });
      await settleMatchCut(page);
      const report = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(report.scrollWidth).toBeLessThanOrEqual(report.clientWidth + 1);
    });
  }
});
