import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expectRoomReady, openRoomIfNeeded } from "./helpers/room-readiness.mjs";
import { Object3D, PerspectiveCamera, Vector3 } from "three";
import { readFileSync } from "node:fs";
import { ROOM_CAMERA_FRAMING } from "../../components/play/room-3d/room-camera-framing.ts";

import { objectFixtures as objects } from "./helpers/object-fixtures.mjs";

async function expectPlayOverview(page, options = {}) {
  await expect(page).toHaveURL((url) => url.pathname === "/play", options);
}

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
    const metrics = {
      currentFrame: 0,
      currentTriangles: 0,
      maximumFrame: 0,
      maximumTriangles: 0,
      total: 0,
    };
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

    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      nativeRequestAnimationFrame((time) => {
        metrics.currentFrame = 0;
        metrics.currentTriangles = 0;
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

async function instrumentDragLatency(page) {
  await page.addInitScript(() => {
    const metrics = {
      pendingPointerMoves: [],
      samples: [],
    };
    Object.defineProperty(window, "__roomDragLatency", {
      configurable: false,
      value: metrics,
    });
    window.addEventListener(
      "pointermove",
      (event) => {
        if ((event.buttons & 1) === 0) return;
        metrics.pendingPointerMoves.push(performance.now());
      },
      true,
    );

    const contexts = [
      window.WebGLRenderingContext,
      window.WebGL2RenderingContext,
    ].filter(Boolean);
    const methods = [
      "drawArrays",
      "drawElements",
      "drawArraysInstanced",
      "drawElementsInstanced",
    ];
    for (const Context of contexts) {
      for (const method of methods) {
        const original = Context.prototype[method];
        if (typeof original !== "function") continue;
        Context.prototype[method] = function (...args) {
          if (metrics.pendingPointerMoves.length > 0) {
            const renderedAt = performance.now();
            for (const startedAt of metrics.pendingPointerMoves.splice(0)) {
              metrics.samples.push(Math.max(0, renderedAt - startedAt));
            }
          }
          return original.apply(this, args);
        };
      }
    }
  });
}

const ROOM_OBJECT_ANCHORS = {
  watch: { wide: [0.40, 0.49], compact: [0.40, 0.49] },
  read: { wide: [0.47, 0.40], compact: [0.47, 0.40] },
  listen: { wide: [0.42, 0.59], compact: [0.42, 0.59] },
  collect: { wide: [0.33, 0.60], compact: [0.33, 0.60] },
  play: { wide: [0.62, 0.53], compact: [0.62, 0.53] },
  move: { wide: [0.58, 0.74], compact: [0.58, 0.74] },
  travel: { wide: [0.49, 0.63], compact: [0.49, 0.63] },
};
const ROOM_ANCHOR_OFFSETS = [
  [0, 0],
  [-0.025, 0],
  [0.025, 0],
  [0, -0.035],
  [0, 0.035],
];
const ROOM_POINTER_SEARCH_DEADLINE_MS = 12_000;

async function nextAnimationFrame(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
}

function roomPoint(bounds, normalizedX, normalizedY) {
  return {
    x: bounds.x + bounds.width * Math.min(0.98, Math.max(0.02, normalizedX)),
    y: bounds.y + bounds.height * Math.min(0.98, Math.max(0.02, normalizedY)),
  };
}

async function stableRoomHit(page, stage, point, expectedId = null) {
  await page.mouse.move(point.x, point.y);
  // One frame is enough for each coarse probe. A possible match receives a
  // second rendered frame before it is accepted, preserving real R3F raycast
  // coverage without paying two frames for every empty grid coordinate.
  await nextAnimationFrame(page);
  const first = await stage.getAttribute("data-room-hovered-object");
  if (!first || (expectedId && first !== expectedId)) return null;
  await nextAnimationFrame(page);
  const second = await stage.getAttribute("data-room-hovered-object");
  return second === first ? { id: first, ...point } : null;
}

function likelyRoomPoints(bounds, id) {
  const anchorSet = ROOM_OBJECT_ANCHORS[id];
  // The room camera switches to its tighter composition well before the
  // semantic page becomes mobile-sized. Treat the 1200px regression viewport
  // as compact so probes follow the projected props after the resize.
  const anchor = anchorSet?.[bounds.width < 1300 ? "compact" : "wide"];
  if (!anchor) return [];
  return ROOM_ANCHOR_OFFSETS.map(([x, y]) =>
    roomPoint(bounds, anchor[0] + x, anchor[1] + y),
  );
}

async function primeRoomPointerSearch(page, bounds) {
  const viewport = page.viewportSize();
  const candidates = [
    { x: 1, y: 1 },
    { x: Math.max(1, (viewport?.width ?? 2) - 2), y: 1 },
    { x: 1, y: Math.max(1, (viewport?.height ?? 2) - 2) },
  ];
  const outside = candidates.find(
    ({ x, y }) =>
      x < bounds.x ||
      x > bounds.x + bounds.width ||
      y < bounds.y ||
      y > bounds.y + bounds.height,
  );
  await page.mouse.move(outside?.x ?? 1, outside?.y ?? 1);
  await nextAnimationFrame(page);
}

function coarseRoomPoints(bounds) {
  const points = [];
  // This bounded fallback covers the authored object band without scanning
  // the empty ceiling and floor margins of the fisheye stage.
  for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      points.push(
        roomPoint(bounds, 0.08 + column * 0.076, 0.24 + row * 0.085),
      );
    }
  }
  return points;
}

async function findInteractiveRoomPoint(page) {
  const stage = page.locator("[data-room-poster-stage]");
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The interactive room has no visible stage.");

  await primeRoomPointerSearch(page, bounds);
  const deadline = Date.now() + ROOM_POINTER_SEARCH_DEADLINE_MS;
  for (const { id } of objects) {
    for (const point of likelyRoomPoints(bounds, id)) {
      if (Date.now() >= deadline) break;
      const hit = await stableRoomHit(page, stage, point, id);
      if (hit) return hit;
    }
  }
  for (const point of coarseRoomPoints(bounds)) {
    if (Date.now() >= deadline) break;
    const hit = await stableRoomHit(page, stage, point);
    if (hit) return hit;
  }

  throw new Error("No procedural room object responded to a real pointer ray.");
}

async function findAllInteractiveRoomPoints(page) {
  const stage = page.locator("[data-room-poster-stage]");
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The interactive room has no visible stage.");

  const points = new Map();
  await primeRoomPointerSearch(page, bounds);
  const deadline = Date.now() + ROOM_POINTER_SEARCH_DEADLINE_MS;

  for (const { id } of objects) {
    if (points.has(id)) continue;
    for (const point of likelyRoomPoints(bounds, id)) {
      if (Date.now() >= deadline) break;
      // Anchors are search hints, not expected raycast results. Keep every
      // stable real hit: a different projection can put the treadmill near
      // the globe hint. Discarding it wastes the bounded search deadline.
      const hit = await stableRoomHit(page, stage, point);
      if (hit) {
        if (!points.has(hit.id)) points.set(hit.id, hit);
        if (hit.id === id) break;
      }
    }
  }

  if (points.size < objects.length) {
    for (const point of coarseRoomPoints(bounds)) {
      if (points.size === objects.length || Date.now() >= deadline) break;
      const hit = await stableRoomHit(page, stage, point);
      if (hit && !points.has(hit.id)) points.set(hit.id, hit);
    }
  }

  return points;
}

const POCKET_HIT_TARGET_GEOMETRY = JSON.parse(readFileSync(
  new URL("../../components/play/room-3d/diorama.generated.json", import.meta.url), "utf8",
)).props;

async function projectedPocketRoomPoints(page) {
  const stage = page.locator("[data-room-poster-stage]");
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The Pocket Room has no visible stage.");

  const camera = new PerspectiveCamera(
    ROOM_CAMERA_FRAMING.pocket.fov,
    bounds.width / bounds.height,
    0.1,
    60,
  );
  camera.position.fromArray(ROOM_CAMERA_FRAMING.pocket.position);
  camera.lookAt(...ROOM_CAMERA_FRAMING.pocket.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const points = new Map();
  expect(Object.keys(POCKET_HIT_TARGET_GEOMETRY).sort()).toEqual(
    objects.map(({ id }) => id).sort(),
  );
  for (const object of objects) {
    const geometry = POCKET_HIT_TARGET_GEOMETRY[object.id];
    const overview = new Object3D();
    const room = new Object3D();
    room.position.set(0, -0.8, 0);
    room.scale.setScalar(0.92);
    overview.add(room);
    const objectRoot = new Object3D();
    objectRoot.position.fromArray(geometry.position);
    objectRoot.rotation.y = geometry.rotation;
    objectRoot.scale.setScalar(geometry.scale);
    room.add(objectRoot);
    const hit = new Object3D();
    hit.position.fromArray(geometry.hit);
    objectRoot.add(hit);
    overview.updateMatrixWorld(true);

    const projected = new Vector3();
    hit.getWorldPosition(projected).project(camera);
    points.set(object.id, {
      id: object.id,
      x: Math.min(
        bounds.x + bounds.width - 8,
        Math.max(bounds.x + 8, bounds.x + ((projected.x + 1) * bounds.width) / 2),
      ),
      y: Math.min(
        bounds.y + bounds.height - 8,
        Math.max(bounds.y + 8, bounds.y + ((1 - projected.y) * bounds.height) / 2),
      ),
    });
  }

  return points;
}

async function resolveProjectedPocketRoomPoint(page, stage, expectedId, point) {
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The Pocket Room has no visible stage.");
  const offsets = [
    [0, 0],
    [-18, 0],
    [18, 0],
    [-36, 0],
    [36, 0],
    [0, -24],
    [0, 24],
    [-36, -24],
    [-36, 24],
    [-60, 0],
    [-60, -32],
    [-60, 32],
  ];

  for (const [offsetX, offsetY] of offsets) {
    const candidate = {
      id: expectedId,
      x: Math.min(
        bounds.x + bounds.width - 8,
        Math.max(bounds.x + 8, point.x + offsetX),
      ),
      y: Math.min(
        bounds.y + bounds.height - 8,
        Math.max(bounds.y + 8, point.y + offsetY),
      ),
    };
    await page.mouse.move(candidate.x, candidate.y);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    if ((await stage.getAttribute("data-room-hovered-object")) === expectedId) {
      return candidate;
    }
  }

  throw new Error(`${expectedId} did not resolve near its projected hit target.`);
}

async function dispatchTouch(client, type, points = []) {
  await client.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map(({ id = 1, x, y }) => ({
      force: 1,
      id: typeof id === "number" ? id : 1,
      radiusX: 2,
      radiusY: 2,
      x: Math.round(x),
      y: Math.round(y),
    })),
  });
}

async function touchTap(client, point) {
  await dispatchTouch(client, "touchStart", [point]);
  await dispatchTouch(client, "touchEnd");
}

async function touchSwipe(client, point, deltaX) {
  await dispatchTouch(client, "touchStart", [point]);
  await dispatchTouch(client, "touchMove", [
    { ...point, x: point.x + deltaX / 2 },
  ]);
  await dispatchTouch(client, "touchMove", [
    { ...point, x: point.x + deltaX },
  ]);
  await dispatchTouch(client, "touchEnd");
}

async function touchSwipeAcrossRenderedFrames(client, page, point, deltaX) {
  await dispatchTouch(client, "touchStart", [point]);
  for (let step = 1; step <= 6; step += 1) {
    await dispatchTouch(client, "touchMove", [
      { ...point, x: point.x + (deltaX * step) / 6 },
    ]);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
  }
  await dispatchTouch(client, "touchEnd");
}

async function selectPocketView(room, view) {
  await room.getByRole("button", { name: "Reset view" }).click();
  await expect(room.getByText("View 2 of 3", { exact: true })).toBeVisible();
  if (view === 1) {
    await room.getByRole("button", { name: "Previous view" }).click();
  } else if (view === 3) {
    await room.getByRole("button", { name: "Next view" }).click();
  }
  await expect(room.getByText(`View ${view} of 3`, { exact: true })).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 360));
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
  test("the explicit directory is provider-free and does not load the renderer", async ({
    page,
  }) => {
    const connectors = [];
    const runtimeScripts = runtimeChunkRequests(page);
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/connectors/")) {
        connectors.push(request.url());
      }
    });

    const response = await page.goto("/play?view=directory", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "My Room, 2001" }),
    ).toBeVisible();
    await expect(page.locator('[data-room-overview] a[href^="/play/"]')).toHaveCount(7);
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

  test("the poster and links remain usable while direct-entry modules load", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let releaseRuntime;
    let runtimeRequested;
    const released = new Promise(resolve => { releaseRuntime = resolve; });
    const requested = new Promise(resolve => { runtimeRequested = resolve; });
    await page.route(/\/RoomRuntime-[^/]+\.js(?:\?.*)?$/, async route => {
      runtimeRequested();
      await released; await route.continue();
    });
    try {
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await requested;
      await expect(page.locator("[data-room-overview] img")).toBeVisible();
      await expect(page.locator('[data-room-object-link="watch"]')).toBeVisible();
      await expect(page.locator("header").getByRole("link", { name: "Work", exact: true })).toBeVisible();
    } finally { releaseRuntime(); }
    await expectRoomReady(page);
  });

  test("the original poster stays usable until the mobile scene is ready", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let releaseModel;
    let modelRequested;
    const released = new Promise(resolve => { releaseModel = resolve; });
    const requested = new Promise(resolve => { modelRequested = resolve; });
    await page.route(/\/assets\/play\/diorama\.[a-f0-9]+\.glb$/, async route => {
      modelRequested();
      await released;
      await route.continue();
    });
    try {
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await requested;
      const overview = page.locator("[data-room-overview]");
      await expect(overview.locator("img")).toBeVisible();
      await expect(overview).not.toHaveAttribute("inert", "");
      const watch = overview.locator('[data-room-object-link="watch"]');
      await watch.focus();
      await expect(watch).toBeFocused();
      await expect(page.locator("[data-room-runtime]")).not.toBeVisible();
      await expect(page.locator("[data-room-poster-fallback]")).toHaveCount(0);
    } finally { releaseModel(); }
    await expectRoomReady(page);
    await expect(page.locator("[data-room-runtime]")).toBeVisible();
    await expect(page.locator("[data-room-overview]")).toHaveAttribute("inert", "");
  });

  test("direct routes render the selected provider foundation without unrelated browser reads", async ({ page }) => {
    const requests = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/connectors/")) requests.push(pathname);
    });

    for (const object of objects) {
      requests.length = 0;
      await page.goto(`/play/${object.id}`, { waitUntil: "domcontentloaded" });
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
    const readLink = page.locator('a[data-room-object-link="read"]');
    await expect(readLink).toHaveAttribute(
      "href",
      "/play/read?fixture=long-title",
    );

    await openRoomIfNeeded(page);
    const room = await expectRoomReady(page, {
      context: "selecting the long-title preview object",
    });
    await room.locator('[data-room-object-control="read"]').click();
    await expect(page).toHaveURL(/\/play\/read\?fixture=long-title$/);
    await page.getByRole("searchbox", { name: "Find a title" }).fill("記憶");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText(/記憶と機械/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to room" })).toHaveAttribute(
      "href",
      "/play?fixture=long-title",
    );
  });

  test("Discogs pagination preserves the explicit preview scenario", async ({ page }) => {
    await page.goto(
      "/play/collect?fixture=maximum-density&pageSize=12",
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("button", { name: "Browse all" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/fixture=maximum-density/);
    await expect(page).toHaveURL(/[?&]page=2(?:&|$)/);
    await expect(page.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  });

  test("selecting a room object does not recurse through the fisheye portal", async ({
    page,
  }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play?fixture=ready", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    await expectRoomReady(page);

    const watch = page.locator('[data-room-object-control="watch"]');
    await expect(watch).toBeVisible();
    await watch.click();
    await expect(page).toHaveURL(/\/play\/watch\?fixture=ready$/);
    expect(
      pageErrors.filter((message) =>
        message.includes("Maximum update depth exceeded"),
      ),
    ).toEqual([]);
  });

  for (const viewport of [
    { height: 900, label: "desktop", width: 1440 },
    { height: 844, label: "Pocket Room", width: 390 },
  ]) {
    test(`the sound control never covers ${viewport.label} room controls`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        hasTouch: viewport.width === 390,
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();
      await page.goto("/play", { waitUntil: "networkidle" });
      await openRoomIfNeeded(page);
      await expectRoomReady(page, {
        context: `checking the ${viewport.label} audio placement`,
        expectedTier: viewport.width === 390 ? "pocket" : undefined,
      });

      const placement = page.locator(
        '[data-experience-audio-control][data-experience-audio-placement="embedded"]',
      );
      await expect(placement).toHaveCount(1);
      const intersections = await page.evaluate(() => {
        const audio = document
          .querySelector("[data-experience-audio-control]")
          ?.getBoundingClientRect();
        if (!audio) return ["missing audio control"];
        return [
          ...document.querySelectorAll(
            "[data-room-view-controls] button, [data-room-object-control]",
          ),
        ]
          .filter((element) => {
            const target = element.getBoundingClientRect();
            return !(
              audio.right <= target.left ||
              audio.left >= target.right ||
              audio.bottom <= target.top ||
              audio.top >= target.bottom
            );
          })
          .map((element) =>
            element.getAttribute("data-room-object-control") ??
            element.textContent?.trim() ??
            element.tagName,
          );
      });
      expect(intersections).toEqual([]);
      await expect(
        page.getByRole("button", { name: "Sound on" }),
      ).toBeVisible();
      await context.close();
    });
  }

  test("direct entry preserves navigation and Objects list stays closed", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play");
    const room = await expectRoomReady(page);
    const leave = room.getByRole("button", { name: "Objects list" });
    await expect(leave).toBeFocused();
    await expect(page.locator("body > header")).not.toHaveAttribute("inert", "");
    await expect(page.locator(".skip-link")).toHaveAttribute("href", "#room-main");
    await expect(room.locator("canvas")).toHaveAttribute("aria-hidden", "true");
    await expect(room.locator("canvas")).toHaveAttribute("tabindex", "-1");
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact))).toEqual([]);
    await leave.click();
    await expect(page).toHaveURL(/view=directory/);
    await expect(room).toHaveCount(0);
    await expect(page.locator('[data-room-object-link="watch"]')).toBeFocused();
    await page.waitForTimeout(500);
    await expect(room).toHaveCount(0);
    await page.getByRole("link", { name: "Open 3D room", exact: true }).click();
    await expectRoomReady(page);
    await page.keyboard.press("Escape");
    await expect(room).toHaveCount(0);
    await expect(page).toHaveURL(/view=directory/);
    await page.locator("header").getByRole("link", { name: "Play", exact: true }).click();
    await expectRoomReady(page);
  });

  test("the shipped fisheye room stays inside its measured composite-render gate", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await instrumentDrawCalls(page);
    await page.goto("/play", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    const stage = page.locator('[data-projection]');
    expect(await stage.getAttribute("data-projection"), await stage.getAttribute("data-projection-reason")).toBe("fisheye");
    await expectRoomReady(page);
    await page.getByRole("button", { name: "Turn right" }).click();
    await page.waitForTimeout(150);

    const metrics = await page.evaluate(() => window.__roomDrawMetrics);
    expect(metrics.total).toBeGreaterThan(0);
    expect(metrics.maximumFrame).toBeLessThanOrEqual(320);
    expect(metrics.maximumTriangles).toBeGreaterThan(0);
    expect(metrics.maximumTriangles).toBeLessThanOrEqual(190_000);
    const pixelRatio = await page.locator("canvas").evaluate((canvas) => ({
      x: canvas.width / canvas.clientWidth,
      y: canvas.height / canvas.clientHeight,
    }));
    expect(pixelRatio.x).toBeLessThanOrEqual(1.26);
    expect(pixelRatio.y).toBeLessThanOrEqual(1.26);

    // The decorative familiar follows actual keyboard focus. Interrupt its
    // rightward reaction, then verify the whole room returns to demand-idle.
    await page.locator('[data-room-object-control="play"]').focus();
    await page.waitForTimeout(100);
    await page.locator('[data-room-object-control="read"]').focus();
    await page.evaluate(() => {
      window.__roomIdleProbe = {
        changedAt: performance.now(),
        total: window.__roomDrawMetrics.total,
      };
    });
    await page.waitForFunction(() => {
      const probe = window.__roomIdleProbe;
      const total = window.__roomDrawMetrics.total;
      if (total !== probe.total) {
        probe.changedAt = performance.now();
        probe.total = total;
      }
      return performance.now() - probe.changedAt >= 350;
    });
    const idleStart = await page.evaluate(() => window.__roomDrawMetrics.total);
    await page.waitForTimeout(500);
    const idleEnd = await page.evaluate(() => window.__roomDrawMetrics.total);
    expect(idleEnd).toBe(idleStart);
  });

  test("sustained slow completed fisheye frames downgrade for the session", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__roomForceSlowFrame = false;
      let animationFrame = 0;
      let delayedAnimationFrame = -1;
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        nativeRequestAnimationFrame((time) => {
          animationFrame += 1;
          callback(time);
        });

      for (const Context of [
        window.WebGL2RenderingContext,
        window.WebGLRenderingContext,
      ].filter(Boolean)) {
        for (const method of [
          "drawArrays",
          "drawElements",
          "drawArraysInstanced",
          "drawElementsInstanced",
        ]) {
          const original = Context.prototype[method];
          if (typeof original !== "function") continue;
          Context.prototype[method] = function (...args) {
            if (
              window.__roomForceSlowFrame &&
              delayedAnimationFrame !== animationFrame
            ) {
              delayedAnimationFrame = animationFrame;
              const startedAt = performance.now();
              while (performance.now() - startedAt < 55) {
                // Test-only simulation of a completed frame missing its budget.
              }
            }
            return original.apply(this, args);
          };
        }
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    const room = page.getByRole("main", { name: "Interactive room" });
    await expect(page.locator('[data-projection="fisheye"]')).toBeVisible();
    await expectRoomReady(page);

    await room.getByRole("button", { name: "Turn right" }).click();
    await room.getByRole("button", { name: "Turn left" }).click();
    await page.evaluate(() => {
      window.__roomForceSlowFrame = true;
    });
    await room.getByRole("button", { name: "Turn right" }).click();
    await room.getByRole("button", { name: "Turn left" }).click();
    await expect(page.locator('[data-projection="wide-perspective"]')).toBeVisible();

    await room.getByRole("button", { name: "Objects list" }).click();
    await page.reload({ waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    await expect(page.locator('[data-projection="wide-perspective"]')).toBeVisible();
    await expectRoomReady(page);
  });

  test("WebGL context loss permanently restores the static semantic room", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    await expectRoomReady(page);
    await page.locator("canvas").evaluate((canvas) => {
      canvas.dispatchEvent(
        new Event("webglcontextlost", { bubbles: false, cancelable: true }),
      );
    });

    await expect(page.getByRole("main", { name: "Interactive room" })).toHaveCount(0);
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
    await expect(page.getByRole("link", { name: "Open 3D room" })).toHaveCount(0);
  });

  test("twenty real drags never open an object and twenty real clicks open the hit object", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await instrumentDragLatency(page);
    await page.goto("/play", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    await expectRoomReady(page);
    const points = await findAllInteractiveRoomPoints(page);
    expect([...points.keys()].sort()).toEqual(objects.map(({ id }) => id).sort());
    const point = points.get("watch") ?? (await findInteractiveRoomPoint(page));
    const room = page.getByRole("main", { name: "Interactive room" });

    for (let index = 0; index < 20; index += 1) {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 12, point.y + (index % 2 ? 2 : -2));
      await page.mouse.up();
      await expectPlayOverview(page);
      await room.getByRole("button", { name: "Reset view" }).click();
      await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
    }

    const latency = await page.evaluate(() => {
      const samples = [...window.__roomDragLatency.samples].sort(
        (left, right) => left - right,
      );
      return {
        count: samples.length,
        p95: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? Infinity,
      };
    });
    expect(latency.count).toBeGreaterThanOrEqual(20);
    expect(latency.p95).toBeLessThan(20);

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
      await expectPlayOverview(page, { timeout: 10_000 });
      await expect(room).toBeVisible();
      await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
      await expect(
        page.locator(`[data-room-object-control="${point.id}"]`),
      ).toBeFocused();
    }
  });

  test("projected hit regions stay aligned through hover motion, resize, and pointer capture", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    await expectRoomReady(page);

    const stage = page.locator("[data-room-poster-stage]");
    const points = await findAllInteractiveRoomPoints(page);
    expect([...points.keys()].sort()).toEqual(objects.map(({ id }) => id).sort());
    const initialBounds = await stage.boundingBox();
    if (!initialBounds) throw new Error("The interactive room has no visible stage.");

    const watch = points.get("watch");
    if (!watch) throw new Error("The television has no pointer hit region.");
    await page.mouse.move(watch.x, watch.y);
    await expect(stage).toHaveAttribute("data-room-hovered-object", "watch");
    await page.waitForTimeout(450);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page).toHaveURL(/\/play\/watch$/, { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expectPlayOverview(page, { timeout: 10_000 });
    await expect(
      page.getByRole("main", { name: "Interactive room" }),
    ).toHaveAttribute("data-room-transition-phase", "idle");

    await page.setViewportSize({ width: 1200, height: 700 });
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-room-poster-stage]")?.getBoundingClientRect()
          .width ?? Infinity) < 900,
    );
    const resizedPoints = await findAllInteractiveRoomPoints(page);
    expect([...resizedPoints.keys()].sort()).toEqual(
      objects.map(({ id }) => id).sort(),
    );
    const resizedBounds = await stage.boundingBox();
    if (!resizedBounds) throw new Error("The resized room has no visible stage.");
    // A changed aspect ratio legitimately changes normalized screen positions.
    // Each newly projected hit region must still identify the correct object.
    for (const [id, point] of resizedPoints) {
      await page.mouse.move(point.x, point.y);
      await expect(stage).toHaveAttribute("data-room-hovered-object", id);
    }
    const collectBeforeDrag = resizedPoints.get("collect");
    if (!collectBeforeDrag) {
      throw new Error("The record crate has no pointer hit region.");
    }
    await page.mouse.move(collectBeforeDrag.x, collectBeforeDrag.y);
    await page.mouse.down();
    await page.mouse.move(resizedBounds.x - 20, resizedBounds.y - 20);
    await page.mouse.up();
    const pointsAfterDrag = await findAllInteractiveRoomPoints(page);
    const collect = pointsAfterDrag.get("collect");
    if (!collect) {
      throw new Error("The record crate lost its pointer hit region after drag.");
    }
    await page.mouse.move(collect.x, collect.y);
    await expect(stage).toHaveAttribute("data-room-hovered-object", "collect");
    await page.mouse.down();
    await page.mouse.up();
    await expect(page).toHaveURL(/\/play\/collect$/, { timeout: 10_000 });
  });

  test("room-originated Back and Escape use browser history and restore exact focus", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    let room = await expectRoomReady(page, {
      context: "opening the first room object",
    });
    await room.locator('[data-room-object-control="watch"]').click();
    await expect(page).toHaveURL(/\/play\/watch$/);
    await expect(page.locator("[data-room-screen-entry-focus]")).toBeFocused();
    await expect(page.locator("[data-room-announcer]")).toContainText(
      `Opened ${objects[0].label}: ${objects[0].title}.`,
    );

    await page.getByRole("link", { name: "Back to room" }).click();
    await expectPlayOverview(page);
    room = page.getByRole("main", { name: "Interactive room" });
    await expect(room).toBeVisible();
    await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
    await expectRoomReady(page, { context: "using the returned room" });
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
    room = page.getByRole("main", { name: "Interactive room" });
    await expect(room).toBeVisible();
    await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
    await expectRoomReady(page, { context: "using browser history in the room" });
    await expect(room.locator('[data-room-object-control="watch"]')).toBeFocused();

    for (const object of objects.filter(({ id }) => id !== "watch")) {
      await room.locator(`[data-room-object-control="${object.id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/play/${object.id}$`), {
        timeout: 10_000,
      });
      await expect(page.locator("[data-room-screen-entry-focus]")).toBeFocused();
      await page.keyboard.press("Escape");
      await expectPlayOverview(page, { timeout: 10_000 });
      room = page.getByRole("main", { name: "Interactive room" });
      await expect(room).toBeVisible();
      await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
      await expectRoomReady(page, {
        context: `returning from the ${object.id} object`,
      });
      await expect(
        room.locator(`[data-room-object-control="${object.id}"]`),
      ).toBeFocused();
    }
  });

  test("a pending history return is acknowledged immediately without exposing controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play?fixture=ready", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    let room = await expectRoomReady(page, {
      context: "starting the slow-return scenario",
    });
    await room.locator('[data-room-object-control="collect"]').click();
    await expect(page).toHaveURL(/\/play\/collect\?fixture=ready$/);

    // History restoration may reuse a client-cached page without a request.
    // Hold the standard browser operation, not a framework-specific RSC URL,
    // so this always exercises the pending state before the real history move.
    await page.evaluate(() => {
      const back = window.history.back.bind(window.history);
      window.__roomPendingReturn = { calls: 0, release: back };
      window.history.back = () => {
        window.__roomPendingReturn.calls += 1;
      };
    });

    try {
      await page.getByRole("link", { name: "Back to room" }).click();
      await expect.poll(() => page.evaluate(() => window.__roomPendingReturn.calls)).toBe(1);
      await expect(page).toHaveURL(/\/play\/collect\?fixture=ready$/);
      const status = page.locator("[data-room-runtime-announcer]");
      await expect(status).toContainText("Returning to the room.");
      room = page.locator("[data-room-runtime]");
      await expect(room).toBeVisible();
      await expect(room).toHaveAttribute("data-room-transition-phase", "returning");
      await expect(room).toHaveAttribute("inert", "");
    } finally {
      await page.evaluate(() => {
        const { calls, release } = window.__roomPendingReturn;
        window.history.back = release;
        delete window.__roomPendingReturn;
        if (calls > 0) release();
      });
    }

    await expect(page).toHaveURL(/\/play\?fixture=ready$/, { timeout: 10_000 });
    await expectRoomReady(page, { context: "completing the slow room return" });
    await expect(
      page.locator('[data-room-object-control="collect"]'),
    ).toBeFocused();
  });

  test("direct object return pushes the room route and restores each semantic link", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    for (const object of objects) {
      await page.goto(`/play/${object.id}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: object.title })).toBeVisible();
      await expect(page.getByRole("main", { name: "Interactive room" })).toHaveCount(0);
      await expect(page.locator("[data-room-announcer]")).toContainText(
        `Opened ${object.label}: ${object.title}.`,
      );
      await page.keyboard.press("Escape");
      await expectPlayOverview(page, { timeout: 10_000 });
      await expectRoomReady(page);
      await expect(page.locator(`[data-room-object-control="${object.id}"]`)).toBeFocused();

      if (object.id === "watch") {
        await openRoomIfNeeded(page);
        const room = await expectRoomReady(page, {
          context: "checking the direct-route return path",
        });
        await expect(room).toBeVisible();
        await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
        await room.getByRole("button", { name: "Objects list" }).click();
        await expect(room).toHaveCount(0);
      }

      await page.goBack({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`/play/${object.id}$`));
      await expect(page.getByRole("heading", { name: object.title })).toBeVisible();
      await expect(page.getByRole("main", { name: "Interactive room" })).toHaveCount(0);
    }
  });

  test("a directly loaded object route stays semantic and does not initialize the room", async ({
    page,
  }) => {
    await page.goto("/play/read", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Bedside Shelf" })).toBeVisible();
    await expect(page.locator("main[data-room-screen]")).toHaveCount(1);
    await expect(page.getByRole("main", { name: "Interactive room" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to room" })).toBeVisible();
  });

  test("a newer object selection cancels an in-flight room transition", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    const room = page.getByRole("main", { name: "Interactive room" });
    await expect(room).toBeVisible();
    await expectRoomReady(page);

    let signalWatchRequest;
    let releaseWatchRequest;
    const watchRequestStarted = new Promise((resolve) => {
      signalWatchRequest = resolve;
    });
    const watchRequestReleased = new Promise((resolve) => {
      releaseWatchRequest = resolve;
    });
    await page.route((url) => url.pathname === "/play/watch", async (route) => {
      if (route.request().headers().rsc !== "1") {
        await route.continue();
        return;
      }
      signalWatchRequest();
      await watchRequestReleased;
      await route.continue();
    });

    try {
      await room.locator('[data-room-object-control="watch"]').click();
      await watchRequestStarted;
      await room
        .locator('[data-room-object-control="play"]')
        .dispatchEvent("click");
    } finally {
      releaseWatchRequest();
    }

    await expect(page).toHaveURL(/\/play\/play$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Desktop Library" })).toBeVisible();
    await expect(page.locator("[data-room-screen-entry-focus]")).toBeFocused();
    await page.getByRole("link", { name: "Back to room" }).click();
    await expectPlayOverview(page, { timeout: 10_000 });
    await expectRoomReady(page, {
      context: "returning after a superseded object selection",
    });
    await expect(
      page.locator('[data-room-object-control="play"]'),
    ).toBeFocused();
  });

  for (const capability of [
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
        viewport: { width: 1440, height: 900 },
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
      if (capability === "zoom-200" || capability === "zoom-400") {
        await context.addInitScript((scale) => {
          if (!window.visualViewport) return;
          Object.defineProperty(window.visualViewport, "scale", {
            configurable: true,
            get: () => scale,
          });
        }, capability === "zoom-200" ? 2 : 4);
      }
      let capabilityProbeIntercepted = false;
      if (capability === "webgl2-unavailable") {
        // Modern Room entry probes off-thread; keep both the Worker and the
        // legacy DOM-canvas fixture unavailable without loading the renderer.
        await context.route(/\/room-capability\.worker-[\w-]+\.js$/, route => {
          capabilityProbeIntercepted = true;
          return route.fulfill({
            contentType: "text/javascript",
            body: "self.postMessage({supported:false}); self.close();",
          });
        });
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
      if (capability === "webgl2-unavailable") {
        await expect.poll(() => capabilityProbeIntercepted).toBe(true);
      }
      await expect(page.locator('[data-room-overview] a[href^="/play/"]')).toHaveCount(7);
      await expect(page.getByRole("link", { name: "Open 3D room" })).toHaveCount(0);
      await expect(page.locator("canvas")).toHaveCount(0);
      expect(runtimeScripts).toEqual([]);
      await context.close();
    });
  }

  for (const capability of ["mobile", "coarse-pointer"]) {
    test(`${capability} opens the touch-native Pocket Room directly`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        hasTouch: capability === "mobile",
        viewport:
          capability === "mobile"
            ? { width: 390, height: 844 }
            : { width: 1024, height: 768 },
      });
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

      const page = await context.newPage();
      const runtimeScripts = runtimeChunkRequests(page);
      await instrumentDrawCalls(page);
      await page.goto("/play", { waitUntil: "networkidle" });
      await expectRoomReady(page);
      const room = await expectRoomReady(page, {
        context: `opening the ${capability} Pocket Room`,
        expectedTier: "pocket",
      });
      const startupDraws = await page.evaluate(() => window.__roomDrawMetrics.total);
      expect(startupDraws, "Pocket startup must not render an invisible entrance tween").toBeLessThanOrEqual(160);
      await nextAnimationFrame(page);
      await nextAnimationFrame(page);
      expect(await page.evaluate(() => window.__roomDrawMetrics.total), "Ready Pocket Room must idle without drawing").toBe(startupDraws);
      await expect(page.locator('[data-projection="pocket-perspective"]')).toBeVisible();
      await expect(room.getByRole("button", { name: "Previous view" })).toBeVisible();
      await expect(room.getByRole("button", { name: "Next view" })).toBeVisible();
      await expect(room.locator('[data-room-object-control="watch"]')).toBeVisible();
      expect(runtimeScripts.length).toBeGreaterThan(0);
      expect(
        runtimeScripts.some((url) => /\/RoomStage-[^/]+\.js$/.test(new URL(url).pathname)),
      ).toBe(false);
      await context.close();
    });
  }

  test("Pocket Room rejects twenty 3D swipe activations per object", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    });
    await context.addInitScript(() => {
      const nativeNow = performance.now.bind(performance);
      let lastReal = nativeNow();
      let virtualNow = lastReal;
      Object.defineProperty(performance, "now", {
        configurable: true,
        value: () => {
          const currentReal = nativeNow();
          virtualNow += Math.min(16, Math.max(0, currentReal - lastReal));
          lastReal = currentReal;
          return virtualNow;
        },
      });
    });

    const page = await context.newPage();
    await page.goto("/play", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    const room = await expectRoomReady(page, {
      context: "testing Pocket Room swipe rejection",
      expectedTier: "pocket",
    });

    const client = await context.newCDPSession(page);
    await selectPocketView(room, 2);
    const objectTouchTargets = await projectedPocketRoomPoints(page);
    const stage = page.locator("[data-room-poster-stage]");
    for (const object of objects) {
      const point = objectTouchTargets.get(object.id);
      if (!point) throw new Error(`${object.id} has no projected touch target.`);
      objectTouchTargets.set(
        object.id,
        await resolveProjectedPocketRoomPoint(
          page,
          stage,
          object.id,
          point,
        ),
      );
    }

    for (const object of objects) {
      const target = objectTouchTargets.get(object.id);
      if (!target) throw new Error(`${object.id} has no 3D touch target.`);
      for (let index = 0; index < 20; index += 1) {
        await selectPocketView(room, 2);
        await touchSwipe(
          client,
          target,
          index % 2 === 0 ? 48 : -48,
        );
        await expectPlayOverview(page);
      }
    }

    await context.close();
  });

  test("Pocket Room activates every object and resets readiness after resize", async ({
    browser,
  }) => {
    test.setTimeout(720_000);
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    });
    await context.addInitScript(() => {
      // This case isolates pointer policy from the separately tested
      // performance downgrade. SwiftShader can report synthetic >33ms deltas
      // during repeated route transitions even when gesture handling is sound.
      const nativeNow = performance.now.bind(performance);
      let lastReal = nativeNow();
      let virtualNow = lastReal;
      Object.defineProperty(performance, "now", {
        configurable: true,
        value: () => {
          const currentReal = nativeNow();
          virtualNow += Math.min(16, Math.max(0, currentReal - lastReal));
          lastReal = currentReal;
          return virtualNow;
        },
      });
    });
    const page = await context.newPage();
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      const states = [];
      Object.defineProperty(window, "__pocketBootStates", {
        configurable: true,
        value: states,
      });
      const record = () => {
        const value = document
          .querySelector("[data-room-boot-status]")
          ?.textContent?.trim();
        if (value && states.at(-1) !== value) states.push(value);
      };
      new MutationObserver(record).observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      record();
    });
    await openRoomIfNeeded(page);
    let room = await expectRoomReady(page, {
      context: "testing Pocket Room activation",
      expectedTier: "pocket",
    });

    const client = await context.newCDPSession(page);

    for (const object of objects) {
      for (let index = 0; index < 20; index += 1) {
        const control = room.locator(
          `[data-room-object-control="${object.id}"]`,
        );
        await control.tap();
        await expect(page).toHaveURL(new RegExp(`/play/${object.id}$`), {
          timeout: 10_000,
        });
        await page.keyboard.press("Escape");
        await expectPlayOverview(page, { timeout: 10_000 });
        room = page.getByRole("main", { name: "Interactive room" });
        await expect(room).toHaveAttribute("data-room-transition-phase", "idle");
        await expect(
          room.locator(`[data-room-object-control="${object.id}"]`),
        ).toBeFocused();
      }
    }

    const stage = page.locator("[data-room-poster-stage]");
    const stageBounds = await stage.boundingBox();
    if (!stageBounds) throw new Error("The Pocket Room has no visible stage.");
    const stagePoint = {
      x: stageBounds.x + stageBounds.width / 2,
      y: stageBounds.y + stageBounds.height / 2,
    };
    await touchSwipe(client, stagePoint, 48);
    await expect(room.getByText(/View [13] of 3/)).toBeVisible();
    await room.getByRole("button", { name: "Reset view" }).click();

    const directPoint = await findInteractiveRoomPoint(page);
    await touchTap(client, directPoint);
    await expect(page).toHaveURL(new RegExp(`/play/${directPoint.id}$`), {
      timeout: 10_000,
    });
    await page.keyboard.press("Escape");
    await expectPlayOverview(page, { timeout: 10_000 });
    room = page.getByRole("main", { name: "Interactive room" });

    await dispatchTouch(client, "touchStart", [directPoint]);
    await dispatchTouch(client, "touchCancel");
    await expectPlayOverview(page);

    await dispatchTouch(client, "touchStart", [directPoint]);
    await dispatchTouch(client, "touchMove", [
      directPoint,
      { id: 2, x: directPoint.x + 18, y: directPoint.y + 4 },
    ]);
    await dispatchTouch(client, "touchEnd");
    await expectPlayOverview(page);

    await selectPocketView(room, 2);
    await dispatchTouch(client, "touchStart", [directPoint]);
    await page.setViewportSize({ width: 844, height: 500 });
    await dispatchTouch(client, "touchEnd");
    const hiddenRuntime = page.locator("[data-room-runtime]");
    await expect(hiddenRuntime).toHaveAttribute("data-room-presentation-tier", "static");
    await expect(hiddenRuntime).toHaveAttribute("data-room-ready", "false");
    await expect(hiddenRuntime).not.toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    const staticOverview = page.locator("[data-room-overview]");
    await expect(staticOverview.locator("img")).toBeVisible();
    await expect(staticOverview).not.toHaveAttribute("inert", "");
    await staticOverview.locator('[data-room-object-link="watch"]').focus();
    await expect(staticOverview.locator('[data-room-object-link="watch"]')).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    room = await expectRoomReady(page, {
      context: "restoring Pocket Room after resize",
      expectedTier: "pocket",
    });
    const bootStates = await page.evaluate(() => window.__pocketBootStates);
    expect(bootStates).toContain("Opening the room");
    expect(bootStates).toContain("Placing objects");
    expect(bootStates.at(-1)).toBe("Room ready");

    await context.close();
  });

  test("Pocket Room ignores idle gaps and downgrades after sustained slow frames", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    });
    await context.addInitScript(() => {
      window.__pocketForceSlowFrame = false;
      let animationFrame = 0;
      let delayedAnimationFrame = -1;
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        nativeRequestAnimationFrame((time) => {
          animationFrame += 1;
          callback(time);
        });

      for (const Context of [
        window.WebGL2RenderingContext,
        window.WebGLRenderingContext,
      ].filter(Boolean)) {
        for (const method of [
          "drawArrays",
          "drawElements",
          "drawArraysInstanced",
          "drawElementsInstanced",
        ]) {
          const original = Context.prototype[method];
          if (typeof original !== "function") continue;
          Context.prototype[method] = function (...args) {
            if (
              window.__pocketForceSlowFrame &&
              delayedAnimationFrame !== animationFrame
            ) {
              delayedAnimationFrame = animationFrame;
              const startedAt = performance.now();
              while (performance.now() - startedAt < 55) {
                // Test-only simulation of a completed Pocket frame missing budget.
              }
            }
            return original.apply(this, args);
          };
        }
      }
    });

    const page = await context.newPage();
    await page.goto("/play", { waitUntil: "networkidle" });
    await openRoomIfNeeded(page);
    const room = await expectRoomReady(page, {
      context: "measuring Pocket Room interaction frames",
      expectedTier: "pocket",
    });

    await page.waitForTimeout(1_200);
    await room.getByRole("button", { name: "Next view" }).click();
    await expect(room).toBeVisible();
    await room.getByRole("button", { name: "Reset view" }).click();

    const client = await context.newCDPSession(page);
    const stage = page.locator("[data-room-poster-stage]");
    const stageBounds = await stage.boundingBox();
    if (!stageBounds) throw new Error("The Pocket Room has no visible stage.");
    const stagePoint = {
      x: stageBounds.x + stageBounds.width / 2,
      y: stageBounds.y + stageBounds.height / 2,
    };

    await page.evaluate(() => {
      window.__pocketForceSlowFrame = true;
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!(await stage.isVisible().catch(() => false))) break;
      await touchSwipeAcrossRenderedFrames(
        client,
        page,
        stagePoint,
        attempt % 2 === 0 ? 72 : -72,
      );
    }

    await expect(room).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator("[data-room-overview]")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open the pocket room" })).toHaveCount(0);
    await expect(page.locator("[data-room-announcer]")).toContainText(
      "interactive room is unavailable",
    );
    await context.close();
  });
});
