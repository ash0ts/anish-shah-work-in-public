import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

const capture = process.env.ROOM_CAPTURE_VISUALS === "1";
const reviewDirectory = path.resolve(".playwright/room-review");
const objects = [
  ["watch", "Midnight Broadcast"],
  ["read", "Borrowed Shelf"],
  ["listen", "Pocket Player"],
  ["collect", "Crate Archive"],
  ["play", "Desktop Library"],
  ["move", "Cardio Television"],
];
const scenarios = [
  "ready",
  "empty",
  "stale",
  "unavailable",
  "long-title",
  "missing-artwork",
];

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

  test("captures the neutral room, rotation bounds, and six focus states", async ({
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
    const room = page.getByRole("dialog", { name: "Interactive room" });
    await expect(room.getByText("Room ready")).toBeVisible();

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

    for (const [id] of objects) {
      const control = room.locator(`[data-room-object-control="${id}"]`);
      await control.focus();
      await expect(control).toHaveAttribute("data-focused", "true");
      await captureRoom(`focus-${id}`);
    }
  });

  for (const [id, title] of objects) {
    test(`captures ${id} across every review fixture`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const scenario of scenarios) {
        const parameters = new URLSearchParams({ fixture: scenario });
        if (id === "collect") parameters.set("view", "gallery");
        await page.goto(`/play/${id}?${parameters}`, {
          waitUntil: "domcontentloaded",
        });
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
        await page.waitForFunction(
          () =>
            document.querySelector("[data-match-cut-state]")?.getAttribute(
              "data-match-cut-state",
            ) === "settled",
        );
        await page.screenshot({
          path: path.join(reviewDirectory, `${id}-${scenario}-desktop.jpg`),
          type: "jpeg",
          quality: 82,
        });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileParameters = new URLSearchParams({ fixture: "ready" });
      if (id === "collect") mobileParameters.set("view", "gallery");
      await page.goto(`/play/${id}?${mobileParameters}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-match-cut-state]")?.getAttribute(
            "data-match-cut-state",
          ) === "settled",
      );
      await page.screenshot({
        path: path.join(reviewDirectory, `${id}-ready-mobile.jpg`),
        type: "jpeg",
        quality: 82,
      });
    });
  }
});
