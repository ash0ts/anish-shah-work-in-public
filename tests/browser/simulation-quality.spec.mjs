import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const clientManifest = JSON.parse(
  await readFile(
    new URL("../../dist/client/.vite/manifest.json", import.meta.url),
    "utf8",
  ),
);
const actionChunk = clientManifest["components/simulation/ActionArena.tsx"].file;
const toneChunk = clientManifest["node_modules/tone/build/esm/index.js"].file;

const requested = (requests, asset) =>
  requests.some((url) => new URL(url).pathname.endsWith(`/${asset}`));

const widths = [320, 390, 768, 1024, 1440, 1920];

test.skip(
  process.env.BROWSER_PLAY_MODE !== "room",
  "Simulation browser coverage runs against the fixture-backed My Room tier.",
);

async function overflowState(page) {
  return page.evaluate(() => {
    const limit = window.innerWidth + 1;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left < -1 || box.right > limit;
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: String(element.className).slice(0, 100),
      }));
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      offenders,
    };
  });
}

for (const width of widths) {
  test(`simulation fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    const response = await page.goto("/simulation", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    const overflow = await overflowState(page);
    expect(overflow, JSON.stringify(overflow.offenders)).toMatchObject({
      documentWidth: expect.any(Number),
      viewportWidth: width,
      offenders: [],
    });
    expect(overflow.documentWidth).toBeLessThanOrEqual(width + 1);
  });
}

test("simulation has no serious or critical Axe findings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/simulation", { waitUntil: "networkidle" });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = result.violations.filter(({ impact }) =>
    ["serious", "critical"].includes(impact),
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});

test("Tactical keeps Phaser and Tone deferred and receives focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/simulation", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Tactical/ }).check();
  await page.getByRole("button", { name: "Boot the public model" }).click();
  const stage = page.locator("[data-simulation-stage]");
  await expect(stage).toBeFocused();
  await expect(page.locator("[data-simulation-tactical-arena]")).toBeVisible();
  expect(requested(requests, actionChunk)).toBe(false);
  expect(requested(requests, toneChunk)).toBe(false);
  await page.getByRole("button", { name: "Sound on" }).click();
  await expect(page.getByRole("button", { name: "Sound off" })).toBeVisible();
  expect(requested(requests, toneChunk)).toBe(true);
  expect(requested(requests, actionChunk)).toBe(false);
});

test("Action loads Phaser only after explicit selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/simulation", { waitUntil: "networkidle" });
  expect(requested(requests, actionChunk)).toBe(false);
  await page.getByRole("radio", { name: /Action/ }).check();
  await page.getByRole("button", { name: "Boot the public model" }).click();
  await expect(page.locator("[data-simulation-action-arena]")).toBeVisible();
  expect(requested(requests, actionChunk)).toBe(true);
  expect(requested(requests, toneChunk)).toBe(false);
});

test("reduced motion selects Tactical without loading Phaser", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/simulation", { waitUntil: "networkidle" });
  await expect(page.getByRole("radio", { name: /Tactical/ })).toBeChecked();
  await page.getByRole("button", { name: "Boot the public model" }).click();
  await expect(page.locator("[data-simulation-tactical-arena]")).toBeVisible();
  expect(requested(requests, actionChunk)).toBe(false);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("shows the inspectable dossier without a dead game form", async ({ page }) => {
    const response = await page.goto("/simulation", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("button", { name: "Boot the public model" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "The public model’s source deck." })).toBeVisible();
    await expect(
      page.getByLabel("Anish simulation disclosure", { exact: true }),
    ).toBeVisible();
  });
});

test("room reveal isolates its background while the robot transition runs", async ({ page }) => {
  test.skip(
    process.env.BROWSER_PLAY_MODE !== "room",
    "The reveal transition belongs to My Room 2001, not Classic Play.",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/play", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Enter the room" }).click();
  await expect(page.getByRole("dialog", { name: "Interactive room" })).toBeVisible();
  await page.route("**/simulation", (route) => route.abort());
  await page
    .getByRole("dialog", { name: "Interactive room" })
    .getByRole("link", { name: "REVEAL THE SIMULATION" })
    .click();
  await expect(page.locator("[data-simulation-reveal-overlay]")).toBeVisible();
  await expect(page.locator("[data-room-runtime]")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-simulation-reveal-overlay]")).toHaveCount(0);
  const revealControl = page.getByRole("link", {
    name: "REVEAL THE SIMULATION",
  }).first();
  await expect(revealControl).toBeFocused();
  await expect(revealControl).not.toHaveAttribute("aria-disabled", "true");

  const runtime = page.locator("[data-room-runtime]");
  if (await runtime.count()) {
    await expect(runtime).not.toHaveAttribute("inert", "");
  } else {
    await expect(page.locator("[data-room-overview]")).not.toHaveAttribute(
      "inert",
      "",
    );
  }
});
