import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { expectRoomReady } from "./helpers/room-readiness.mjs";

const capture = process.env.ROOM_CAPTURE_VISUALS === "1";
const reviewDirectory = path.resolve(".playwright/room-review");
const objects = [
  "watch",
  "read",
  "listen",
  "collect",
  "play",
  "move",
  "travel",
];
const scenarios = [
  "ready",
  "empty",
  "stale",
  "unavailable",
  "long-title",
  "missing-artwork",
];
const connectorObjects = objects.filter((id) => id !== "travel");

async function settleRoomScreen(page) {
  if ((await page.locator("[data-match-cut-state]").count()) === 0) return;
  await page.waitForFunction(
    () =>
      document.querySelector("[data-match-cut-state]")?.getAttribute(
        "data-match-cut-state",
      ) === "settled",
  );
}

async function captureJpeg(page, filename) {
  await page.screenshot({
    path: path.join(reviewDirectory, filename),
    type: "jpeg",
    quality: 82,
  });
}

async function openCollectionScreen(page, id, parameters) {
  const response = await page.goto(`/play/${id}?${parameters}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);
  const screen = page.locator("main[data-room-screen]");
  // The semantic heading precedes the animated surface, so it remains readable
  // throughout the match cut and when the enhancement is unavailable.
  await expect(screen.getByRole("heading", { level: 1 })).toHaveText(/\S+/);
  await expect(
    screen.locator(`[data-match-cut-object="${id}"]`),
  ).toHaveCount(1);
  await settleRoomScreen(page);
}

test.describe("My Room 2001 visual review evidence", () => {
  test.skip(!capture, "Run npm run capture:room-review to create review evidence.");

  test.beforeAll(async () => {
    await rm(reviewDirectory, { force: true, recursive: true });
    await mkdir(reviewDirectory, { recursive: true });
  });

  test.afterAll(async () => {
    const files = (await readdir(reviewDirectory)).sort();
    await writeFile(
      path.join(reviewDirectory, "manifest.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          releaseSha: process.env.GITHUB_SHA ?? "local",
          fixtureData: "synthetic-preview-only",
          files,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  });

  test("captures the neutral room, rotation bounds, and seven focus states", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play", { waitUntil: "networkidle" });
    await page.screenshot({
      path: path.join(reviewDirectory, "room-static-poster.jpg"),
      type: "jpeg",
      quality: 82,
    });

    await page.getByRole("button", { name: "Enter the room" }).click();
    const room = await expectRoomReady(page, {
      context: "capturing room review evidence",
      expectedTier: "desktop-fisheye",
    });

    const captureRoom = async (name) => {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.screenshot({
        path: path.join(reviewDirectory, `room-${name}.jpg`),
        type: "jpeg",
        quality: 82,
      });
    };
    const click = async (name, count) => {
      const control = room.getByRole("button", { name });
      for (let index = 0; index < count; index += 1) await control.click();
    };

    await captureRoom("neutral");
    await room.locator("[data-room-poster-stage]").screenshot({
      path: path.join(reviewDirectory, "room-neutral-stage.png"),
    });
    await click("Turn left", 3);
    await captureRoom("rotation-left");
    await room.getByRole("button", { name: "Reset view" }).click();
    await click("Turn right", 3);
    await captureRoom("rotation-right");
    await room.getByRole("button", { name: "Reset view" }).click();
    await click("Tilt up", 2);
    await captureRoom("rotation-up");
    await room.getByRole("button", { name: "Reset view" }).click();
    await click("Tilt down", 2);
    await captureRoom("rotation-down");
    await room.getByRole("button", { name: "Reset view" }).click();

    for (const id of objects) {
      const control = room.locator(`[data-room-object-control="${id}"]`);
      await control.focus();
      await expect(control).toHaveAttribute("data-focused", "true");
      await captureRoom(`focus-${id}`);
    }
  });

  for (const id of connectorObjects) {
    test(`captures ${id} across every review fixture`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const scenario of scenarios) {
        const parameters = new URLSearchParams({ fixture: scenario });
        if (id === "collect") parameters.set("view", "gallery");
        await openCollectionScreen(page, id, parameters);
        await captureJpeg(page, `${id}-${scenario}-desktop.jpg`);
      }

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileParameters = new URLSearchParams({ fixture: "ready" });
      if (id === "collect") mobileParameters.set("view", "gallery");
      await openCollectionScreen(page, id, mobileParameters);
      await captureJpeg(page, `${id}-ready-mobile.jpg`);
    });
  }

  test("captures every distinct Postcard Planet review state", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/play/travel?fixture=world", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Postcard Planet", exact: true }),
    ).toBeVisible();
    await settleRoomScreen(page);
    await expect(page.locator("[data-travel-trip]")).toHaveCount(2);
    await expect(
      page.getByRole("heading", { name: "World", exact: true }),
    ).toBeVisible();
    await captureJpeg(page, "travel-world-desktop.jpg");

    await page.goto("/play/travel?fixture=empty", {
      waitUntil: "domcontentloaded",
    });
    await settleRoomScreen(page);
    await expect(page.locator("[data-travel-trip]")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "No trips here yet", exact: true }),
    ).toBeVisible();
    await captureJpeg(page, "travel-empty-desktop.jpg");

    await page.goto("/play/travel?fixture=planned", {
      waitUntil: "domcontentloaded",
    });
    await settleRoomScreen(page);
    await expect(page.locator("[data-travel-trip]")).toHaveCount(1);
    await expect(page.getByText("Planned trip", { exact: true })).toBeVisible();
    await expect(page.locator("[data-travel-trip] img")).toHaveCount(0);
    await captureJpeg(page, "travel-planned-desktop.jpg");

    await page.goto("/play/travel?fixture=completed", {
      waitUntil: "domcontentloaded",
    });
    await settleRoomScreen(page);
    await expect(page.locator("[data-travel-trip]")).toHaveCount(1);
    await expect(page.getByText("Travel log", { exact: true })).toBeVisible();
    await expect(page.locator('[data-travel-country="US"]')).toContainText(
      "1 trip",
    );
    await captureJpeg(page, "travel-completed-desktop.jpg");

    await page.locator('[data-travel-country="US"]').click();
    await expect(
      page.getByRole("heading", {
        name: "United States of America",
        exact: true,
      }),
    ).toBeVisible();
    await captureJpeg(page, "travel-country-united-states-desktop.jpg");

    const newYork = page.locator('[data-travel-region="US-NY"]');
    await expect(newYork).toBeVisible();
    await newYork.click();
    await expect(newYork).toHaveAttribute("aria-pressed", "true");
    await captureJpeg(page, "travel-admin1-new-york-desktop.jpg");

    const longCaptionResponse = await page.goto(
      "/play/travel/trips/long-caption-preview?fixture=long-caption",
      { waitUntil: "domcontentloaded" },
    );
    expect(longCaptionResponse?.status()).toBe(200);
    await settleRoomScreen(page);
    await expect(page.locator("[data-travel-trip-log]")).toBeVisible();
    await expect(page).toHaveTitle(/A postcard with enough context/);
    await expect(
      page.getByText(/The light changed while the street kept moving/),
    ).toBeVisible();
    await captureJpeg(page, "travel-long-caption-desktop.jpg");

    const missingResponses = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/api/travel-media/")) {
        missingResponses.push(response.status());
      }
    });
    const missingMediaResponse = await page.goto(
      "/play/travel/trips/missing-media-preview?fixture=missing-media",
      { waitUntil: "networkidle" },
    );
    expect(missingMediaResponse?.status()).toBe(200);
    await settleRoomScreen(page);
    await expect(page.locator("[data-travel-trip-log] img")).toHaveCount(1);
    expect(missingResponses).toContain(404);
    await captureJpeg(page, "travel-missing-media-desktop.jpg");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/play/travel?fixture=world", {
      waitUntil: "domcontentloaded",
    });
    await settleRoomScreen(page);
    await expect(page.locator("[data-travel-trip]")).toHaveCount(2);
    await captureJpeg(page, "travel-world-mobile.jpg");
  });
});
