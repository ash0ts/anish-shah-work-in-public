import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const button = (page, name) => page.getByRole("button", { name, exact: true });
async function ready(page) {
  await page.goto("/simulation");
  await expect(page.locator("[data-network-ready=true]")).toBeVisible();
  await expect(button(page, "Chip folder")).toBeEnabled();
}
async function folder(page) {
  await button(page, "Chip folder").click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function close(page) {
  await button(page, "Close panel").click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}
async function fits(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
}
for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`world, folder and dialogue fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    await fits(page);
    await expect(page.locator("[data-network-canvas] canvas")).toBeVisible();
    await folder(page);
    await expect(page.locator("#network-panel-title")).toBeFocused();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("combobox", { name: "Program", exact: true }),
    ).toHaveCount(6);
    await fits(page);
    await close(page);
    await button(page, "Chat").click();
    await fits(page);
    await page
      .getByLabel("Ask about this discovery", { exact: true })
      .fill("What does the MCP project show?");
    await button(page, "Send question").click();
    await expect(page.getByRole("log")).toContainText("Authored archive reply");
    await expect(page.getByRole("log")).toContainText("MCP");
    await fits(page);
    await close(page);
    await page.screenshot({
      path: `.playwright/network-${width}.png`,
      fullPage: true,
    });
  });
}
test("catalog paging, source inspection, equipment, pair metadata and focus restoration", async ({
  page,
}) => {
  await ready(page);
  await folder(page);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("88 discoveries", { exact: true }),
  ).toBeVisible();
  await button(page, "Next").click();
  await expect(button(page, "Previous")).toBeEnabled();
  await button(page, "Previous").click();
  await dialog.getByLabel("Search saved catalog").fill("MCP");
  await button(page, "Search").click();
  const item = dialog.locator("ul button").first();
  await item.click();
  await expect(
    dialog.getByText("Discovery chip", { exact: true }),
  ).toBeVisible();
  await button(page, "Slot 1 / Pulse").click();
  await button(page, "Inspect another").click();
  await dialog.getByLabel("Search saved catalog").fill("ARIA");
  await button(page, "Search").click();
  await dialog.locator("ul button").first().click();
  await expect(dialog).toContainText(/Shared metadata|No documented shared/);
  await button(page, "Ask about this").click();
  await expect(
    page.getByLabel("Ask about this discovery", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(button(page, "Chip folder")).toBeFocused();
});
test("all five fixture collections page on demand; exploration and authored chat spend nothing", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await ready(page);
  await folder(page);
  for (const name of ["Anime", "Books", "Games", "Tracks", "Records"]) {
    await button(page, name).click();
    await expect(page.getByRole("dialog")).toContainText("26 discoveries");
    await expect(page.getByRole("dialog").locator("ul button")).toHaveCount(24);
    await button(page, "Next").click();
    await expect(page.getByRole("dialog").locator("ul button")).toHaveCount(2);
  }
  await page.getByRole("dialog").locator("ul button").first().click();
  await expect(page.getByRole("dialog")).toContainText("Fixture");
  await expect(page.getByRole("dialog")).toContainText("Updated");
  await button(page, "Ask about this").click();
  await button(page, "What does this show?").click();
  await expect(page.getByRole("log")).toContainText("Authored archive reply");
  expect(
    requests.filter((url) =>
      /api\/simulation|googleapis|api\/connectors|api\/travel|api\.spotify|api\.discogs/.test(
        url,
      ),
    ),
  ).toEqual([]);
});
test("all encounters share Step rules, pause in the folder, retry and skip without losing discoveries", async ({
  page,
}) => {
  await ready(page);
  await button(page, "Still presentation").click();
  await page.getByText("Optional encounters · 0/3", { exact: true }).click();
  for (const name of [
    "1. First contact",
    "2. Crossed wires",
    "3. Network glitch",
  ]) {
    await button(page, name).click();
    const battle = page.getByRole("region", { name: "Battle controls" });
    await expect(battle.getByLabel("Step mode")).toBeChecked();
    await expect(
      battle
        .getByRole("group", { name: "Six-column three-row battle board" })
        .getByRole("button"),
    ).toHaveCount(18);
    await button(page, "Use Pulse").click();
    await expect(button(page, "Use Guard")).toBeDisabled();
    await button(page, "Advance one step").click();
    await expect(button(page, "Use Guard")).toBeEnabled();
    await button(page, "Load programs · pauses battle").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await button(page, "Load hand & resume").click();
    await expect(battle).toBeVisible();
    await button(page, "Retry").click();
    await expect(battle).toContainText("YOU 12/12");
    await button(page, "Leave battle").click();
    await expect(battle).not.toBeVisible();
  }
});
test("progress is opt-in, ID-only, bounded, restored and reset", async ({
  page,
}) => {
  await ready(page);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("4n1sh:network-progress:v1"),
    ),
  ).toBeNull();
  await folder(page);
  await page.getByRole("dialog").locator("ul button").first().click();
  await close(page);
  await button(page, "Journal").click();
  await page.getByLabel("Remember progress on this device").check();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("4n1sh:network-progress:v1")),
  );
  expect(saved.discoveries).toHaveLength(1);
  expect(Object.keys(saved).sort()).toEqual(
    [
      "version",
      "discoveries",
      "equipped",
      "completed",
      "stepMode",
      "sound",
    ].sort(),
  );
  await page.reload();
  await expect(page.locator("[data-network-ready=true]")).toBeVisible();
  await button(page, "Journal").click();
  await expect(
    page.getByLabel("Remember progress on this device"),
  ).toBeChecked();
  await button(page, "Reset progress").click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("4n1sh:network-progress:v1"),
    ),
  ).toBeNull();
});
test("Back, Forward and Escape restore interface state without sending questions in URLs", async ({
  page,
}) => {
  await ready(page);
  await folder(page);
  await page.goBack();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goForward();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});
for (const mode of ["reducedMotion", "forcedColors"]) {
  test(`${mode} uses HTML and Step mode without loading Phaser art`, async ({
    page,
  }) => {
    await page.emulateMedia(
      mode === "reducedMotion"
        ? { reducedMotion: "reduce" }
        : { forcedColors: "active" },
    );
    const requests = [];
    page.on("request", (r) => requests.push(r.url()));
    await ready(page);
    await expect(page.locator("[data-network-canvas]")).toHaveCount(0);
    await folder(page);
    await fits(page);
    expect(requests.filter((url) => url.includes("network-props-v1"))).toEqual(
      [],
    );
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
test("no JavaScript retains four characters and six reviewed source links", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/simulation");
  await page
    .getByText("Characters & source navigation", { exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Complete Work archive ↗" }),
  ).toBeVisible();
  await expect(page.locator("main details ul a")).toHaveCount(6);
  await fits(page);
  await context.close();
});
test("missing sprites fall back to named semantic controls", async ({
  page,
}) => {
  await page.route("**/assets/simulation/*.webp", (route) => route.abort());
  await ready(page);
  await expect(page.locator("[data-network-canvas]")).toHaveCount(0);
  await folder(page);
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("touch navigation and station controls work at 390px", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await ready(page);
  await button(page, "02 / Media archive").tap();
  await expect(page.getByRole("dialog")).toContainText("26 discoveries");
  await close(page);
  await button(page, "Down").tap();
  await fits(page);
  await context.close();
});
test("keyboard movement, bounded scene redraw and route departure keep one canvas", async ({
  page,
}) => {
  await ready(page);
  await expect(page.locator("[data-network-canvas] canvas")).toHaveCount(1);
  const world = page.getByRole("region", { name: "Personal network world" });
  await world.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await close(page);
  await page.getByRole("link", { name: "Leave ↗", exact: true }).click();
  await expect(page.locator("[data-network-canvas]")).toHaveCount(0);
});
test("the renderer sleeps at rest and while dialogue is open", async ({
  page,
}) => {
  await ready(page);
  const renderer = page.locator("[data-renderer-ready=true]");
  await expect(renderer).toBeVisible();
  // Observe a full quiet interval after the bounded interaction animation.
  await page.waitForTimeout(800);
  const resting = await renderer.getAttribute("data-render-frames");
  await page.waitForTimeout(400);
  expect(await renderer.getAttribute("data-render-frames")).toBe(resting);
  await button(page, "Chat").click();
  await page.waitForTimeout(800);
  const paused = await renderer.getAttribute("data-render-frames");
  await page
    .getByLabel("Ask about this discovery", { exact: true })
    .fill("No request until Send.");
  await page.waitForTimeout(400);
  expect(await renderer.getAttribute("data-render-frames")).toBe(paused);
});
test("Play does not preload the game, catalog, or model", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/play?view=directory");
  await expect(page.getByRole("main")).toBeVisible();
  await page.waitForTimeout(600);
  expect(
    requests.filter((url) =>
      /network-(cast|props)|renderer-.*\.js|api\/simulation|generativelanguage/.test(
        url,
      ),
    ),
  ).toEqual([]);
});
test("default world and dialogue pass Axe and 200/400 percent equivalent reflow", async ({
  page,
}) => {
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
  }
  await button(page, "Chat").click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
