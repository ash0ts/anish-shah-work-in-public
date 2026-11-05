import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const button = (page, name) => page.getByRole("button", { name, exact: true });
const inspect = (page) => button(page, "Inspect project ↗");
async function ready(page) {
  await page.goto("/simulation");
  await expect(button(page, "Still presentation")).toBeEnabled();
  await expect(button(page, "Load reader A")).toBeVisible();
}
async function openMcp(page) {
  await button(page, "Load reader A").click();
  await inspect(page).click();
}
async function pair(page) {
  await button(page, "Load reader A").click();
  await button(page, "Next cartridge").click();
  await button(page, "Load reader B").click();
  await button(page, "Patch together").click();
}
async function fits(page) {
  expect(
    await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= innerWidth + 1,
      offenders: [...document.querySelectorAll("main *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width && (r.right > innerWidth + 1 || r.left < -1);
        })
        .map((el) => el.className)
        .slice(0, 12),
    })),
  ).toMatchObject({ fits: true });
}
for (const width of [320, 1024, 1440]) {
  test(`every cartridge loads, opens, closes, and ejects at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    for (const name of [
      "W&B MCP Server",
      "AutoResearch labs",
      "Agent Lens studies",
      "Your Agent Learned to Cheat",
      "ARIA",
      "Fugue",
    ]) {
      await button(page, "Load reader A").click();
      await expect(button(page, "Load reader A")).toContainText(name);
      await inspect(page).click();
      await expect(page.locator("[data-window] h2")).toBeFocused();
      await button(page, `Close ${name}`).click();
      await expect(inspect(page)).toBeFocused();
      await button(page, "Eject A").click();
      await expect(button(page, "Eject A")).toBeDisabled();
      await button(page, "Next cartridge").click();
    }
    await fits(page);
  });
}
test("dial keyboard input, deduplicated readers, and interrupted dragging retain usable state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  const dial = page.getByRole("slider", { name: "Browse cartridges" });
  await dial.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dial).toHaveValue("1");
  await button(page, "Load reader A").click();
  await button(page, "Load reader B").click();
  await expect(button(page, "Load reader A")).toContainText(
    "Drop a cartridge here",
  );
  await expect(button(page, "Load reader B")).toContainText(
    "AutoResearch labs",
  );
  await expect(button(page, "Patch together")).toBeDisabled();
  const cartridge = button(page, "Insert AutoResearch labs");
  await cartridge.scrollIntoViewIfNeeded();
  const box = await cartridge.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 35, box.y - 60, { steps: 6 });
  await cartridge.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(button(page, "Load reader A")).toContainText(
    "Drop a cartridge here",
  );
  await cartridge.focus();
  await page.keyboard.press("Enter");
  await expect(button(page, "Load reader A")).toContainText(
    "AutoResearch labs",
  );
});
test("drag into a reader loads once; dropping outside loads nothing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  const cartridge = button(page, "Insert W&B MCP Server");
  const from = await cartridge.boundingBox();
  const to = await button(page, "Load reader B").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(button(page, "Load reader B")).toContainText("W&B MCP Server");
  await expect(button(page, "Load reader A")).toContainText(
    "Drop a cartridge here",
  );
  await button(page, "Eject B").click();
  const again = await cartridge.boundingBox();
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(30, 100, { steps: 12 });
  await page.mouse.up();
  await expect(button(page, "Eject A")).toBeDisabled();
  await expect(button(page, "Eject B")).toBeDisabled();
});
test("second pointer, resize, and lost capture cancel without loading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  const cartridge = button(page, "Insert W&B MCP Server");
  for (const interruption of ["second-pointer", "resize", "lost-capture"]) {
    const from = await cartridge.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x - 40, from.y, { steps: 5 });
    if (interruption === "second-pointer")
      await page.locator("body").dispatchEvent("pointerdown", {
        pointerId: 99,
        pointerType: "touch",
        isPrimary: false,
      });
    if (interruption === "resize")
      await page.setViewportSize({ width: 1400, height: 1000 });
    if (interruption === "lost-capture")
      await cartridge.dispatchEvent("lostpointercapture", { pointerId: 1 });
    const to = await button(page, "Load reader B").boundingBox();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    await expect(button(page, "Eject A")).toBeDisabled();
    await expect(button(page, "Eject B")).toBeDisabled();
  }
});
test("touch cartridge loading and explicit controls work without dragging", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await ready(page);
  await button(page, "Insert W&B MCP Server").tap();
  await expect(button(page, "Load reader A")).toContainText("W&B MCP Server");
  await button(page, "Next cartridge").tap();
  await button(page, "Load reader B").tap();
  await button(page, "Patch together").tap();
  await expect(
    page.getByRole("region", { name: "Documented connection" }),
  ).toBeVisible();
  await fits(page);
  await context.close();
});
test("missing artwork keeps named controls and ordinary inspection", async ({
  page,
}) => {
  await page.route("**/assets/simulation/*.webp", (route) => route.abort());
  await ready(page);
  await openMcp(page);
  await expect(page.locator("[data-window] h2")).toBeFocused();
  await page
    .locator("[data-window]")
    .getByRole("button", { name: "Ask 4N1SH", exact: true })
    .click();
  await expect(
    page.getByLabel("Ask about the work", { exact: true }),
  ).toBeFocused();
});
test("load, patch, ask, and journal complete the optional trail with zero provider calls", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await ready(page);
  await expect(page.locator("[data-experience-audio-control]")).toHaveCount(0);
  await button(page, "Optional trail +").click();
  await pair(page);
  await expect(
    page.getByRole("region", { name: "Documented connection" }),
  ).toContainText("Evaluation & observability");
  await page.screenshot({
    path: ".playwright/media-console-connection.png",
    fullPage: true,
  });
  await button(page, "Ask about this pair ↗").click();
  await expect(
    page.getByLabel("Ask about the work", { exact: true }),
  ).toBeFocused();
  await button(page, "Send question").click();
  await expect(page.getByRole("log")).toContainText(
    "not evidence that one project caused",
  );
  await page.getByRole("log").getByText("Sources · 2", { exact: true }).click();
  await expect(
    page
      .getByRole("log")
      .getByRole("link", { name: /W&B MCP/ })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: /Journal.*2/ }).click();
  await expect(
    page.getByRole("region", { name: "Discovery journal" }),
  ).toContainText("A little trail");
  expect(
    requests.filter((url) =>
      /api\/simulation|api\/connectors|api\/travel|googleapis|generativelanguage/.test(
        url,
      ),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() => JSON.stringify(history.state)),
  ).not.toContain("How do these connect");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("artifact dragging, reset, history, Escape, and messenger return preserve focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await openMcp(page);
  const window = page.locator("[data-window]");
  const initial = await window.boundingBox();
  const handle = await window
    .getByText("terminal.open", { exact: true })
    .boundingBox();
  await page.mouse.move(handle.x + 30, handle.y + 15);
  await page.mouse.down();
  await page.mouse.move(1400, 100, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() =>
      window.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const field = element.parentElement.getBoundingClientRect();
        return (
          box.left >= field.left &&
          box.right <= field.right + 1 &&
          box.top >= field.top &&
          box.bottom <= field.bottom + 1
        );
      }),
    )
    .toBe(true);
  await window.getByRole("button", { name: "Reset position" }).click();
  await expect
    .poll(async () => Math.round((await window.boundingBox()).x))
    .toBe(Math.round(initial.x));
  await page.goBack();
  await expect(window).toHaveCount(0);
  await page.goForward();
  await expect(window).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(inspect(page)).toBeFocused();
  await button(page, "Ask 4N1SH ↗").click();
  await expect(
    page.getByLabel("Ask about the work", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button(page, "Ask 4N1SH ↗")).toBeFocused();
});
for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`console, artifact, messenger, and journal fit ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    await page.screenshot({
      path: `.playwright/media-console-${width}.png`,
      fullPage: true,
    });
    await fits(page);
    if (width === 320 || width === 1440)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await openMcp(page);
    await fits(page);
    await page
      .locator("[data-window]")
      .getByRole("button", { name: "Ask 4N1SH", exact: true })
      .click();
    await button(page, "Send question").click();
    await expect(page.getByRole("log")).toContainText("MCP");
    await expect
      .poll(() =>
        page
          .getByRole("log")
          .evaluate(
            (element) =>
              element.scrollHeight - element.scrollTop - element.clientHeight <
              2,
          ),
      )
      .toBe(true);
    await fits(page);
    await page.screenshot({
      path: `.playwright/media-console-chat-${width}.png`,
      fullPage: true,
    });
    if (width === 320 || width === 1440)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
test("no-JavaScript fallback and full archive remain ordinary links", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/simulation");
  const link = page.getByRole("link", {
    name: "Open W&B MCP Server",
    exact: true,
  });
  await expect(link).toHaveAttribute("href", "/work/wandb-mcp-server");
  await page
    .locator("summary")
    .filter({ hasText: "Browse the whole archive" })
    .click();
  await expect(page.locator("details ul li")).toHaveCount(88);
  await link.click();
  await expect(page).toHaveURL(/\/work\/wandb-mcp-server$/);
  await context.close();
});
test("reduced motion, still mode, and forced colors retain the keyboard loop", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await ready(page);
  await button(page, "Load reader A").focus();
  await page.keyboard.press("Enter");
  await inspect(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-window] h2")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inspect(page)).toBeFocused();
  await pair(page);
  await expect(
    page.getByRole("heading", { name: "A documented thread." }),
  ).toBeVisible();
  await button(page, "Still presentation").click();
  await expect(button(page, "Still presentation")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page.locator("main [data-panel]").evaluate((element) =>
      element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.playState === "running")
        .map((animation) => ({
          target: animation.effect?.target?.outerHTML,
          property: animation.transitionProperty,
          animation: animation.animationName,
        })),
    ),
  ).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
for (const zoom of [2, 4])
  test(`${zoom * 100}% reflow and mobile keyboard`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 1280 / zoom, height: 720 / zoom });
    await ready(page);
    await button(page, "Chat").click();
    const question = page.getByLabel("Ask about the work", { exact: true });
    await question.fill("MCP");
    await expect(button(page, "Send question")).toBeEnabled();
    await question.press(
      browserName === "webkit" && process.platform === "darwin"
        ? "Alt+Tab"
        : "Tab",
    );
    await expect(button(page, "Send question")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("log")).toContainText("MCP");
    await fits(page);
  });
