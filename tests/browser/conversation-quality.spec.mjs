import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const openMcp = (page) =>
  page.getByRole("link", { name: "Open W&B MCP Server", exact: true });
const choose = (page, name) =>
  page.getByRole("button", {
    name: `Select ${name} for connection`,
    exact: true,
  });
async function ready(page) {
  await page.goto("/simulation");
  await expect(
    page.getByRole("button", { name: "Still presentation", exact: true }),
  ).toBeEnabled();
}
async function pair(page) {
  await choose(page, "W&B MCP Server").click();
  await choose(page, "AutoResearch labs").click();
  await page.getByRole("button", { name: "Connect ↗", exact: true }).click();
}
for (const width of [320, 1024, 1440]) {
  // Isolate viewport cases, including browser history, in fresh contexts.
  test(`every media object opens and closes without covering connection controls at ${width}px`, async ({
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
      await page
        .getByRole("link", { name: `Open ${name}`, exact: true })
        .click();
      await expect(page.locator("[data-window] h2")).toBeFocused();
      await page
        .getByRole("button", { name: `Close ${name}`, exact: true })
        .click();
    }
    if (width >= 900) {
      const messenger = await page
        .getByRole("region", { name: /4N1SH.*Messenger/i })
        .boundingBox();
      const connect = await page
        .getByRole("button", { name: "Connect ↗", exact: true })
        .boundingBox();
      expect(messenger.y + messenger.height).toBeLessThanOrEqual(connect.y);
    }
  });
}

test("missing decorative media leaves every project and companion control named and usable", async ({
  page,
}) => {
  await page.route("**/assets/simulation/*.webp", (route) => route.abort());
  await ready(page);
  await expect(openMcp(page)).toContainText("W&B MCP Server");
  await openMcp(page).click();
  await expect(page.locator("[data-window] h2")).toBeFocused();
  await page.getByRole("button", { name: "Ask 4N1SH", exact: true }).click();
  await expect(
    page.getByLabel("Ask about the work", { exact: true }),
  ).toBeFocused();
});

test("open, connect, ask, journal, and optional trail are real interactions with zero provider calls", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await ready(page);
  await expect(page.locator("[data-experience-audio-control]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Optional trail +", exact: true })
    .click();
  await openMcp(page).click();
  await expect(page.locator("[data-window] h2")).toBeFocused();
  await page
    .getByRole("button", { name: "Close W&B MCP Server", exact: true })
    .click();
  await expect(openMcp(page)).toBeFocused();
  await pair(page);
  await expect(
    page.getByRole("region", { name: "Documented connection" }),
  ).toContainText("Evaluation & observability");
  await page.screenshot({
    path: ".playwright/personal-internet-connection.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Ask about this pair ↗" }).click();
  await expect(
    page.getByLabel("Ask about the work", { exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Send question" }).click();
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
  expect(page.url()).not.toContain("connect");
  expect(
    await page.evaluate(() => JSON.stringify(history.state)),
  ).not.toContain("How do these connect");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("dragged artifact windows remain bounded and offer a reset button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await openMcp(page).click();
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
});
test("window limit, Escape, Back/Forward, and focus restore without leaving the workspace", async ({
  page,
}) => {
  await ready(page);
  await openMcp(page).click();
  await page
    .getByRole("link", { name: "Open AutoResearch labs", exact: true })
    .click();
  await expect(page.locator("[data-window]")).toHaveCount(2);
  await page.goBack();
  await expect(page.locator("[data-window]")).toHaveCount(1);
  await page.goForward();
  await expect(page.locator("[data-window]")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-window]")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Open AutoResearch labs", exact: true }),
  ).toBeFocused();
});
for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`workspace, artifact, messenger, and journal fit ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    await page.screenshot({
      path: `.playwright/personal-internet-${width}.png`,
      fullPage: true,
    });
    const fits = async () =>
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    await fits();
    await openMcp(page).click();
    await fits();
    await page.getByRole("button", { name: "Ask 4N1SH", exact: true }).click();
    await page.getByRole("button", { name: "Send question" }).click();
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
    await fits();
    await page.screenshot({
      path: `.playwright/personal-internet-chat-${width}.png`,
      fullPage: true,
    });
    if (width === 320 || width === 1440)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
test("no-JavaScript objects and the complete archive remain useful ordinary links", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/simulation");
  await expect(openMcp(page)).toHaveAttribute("href", "/work/wandb-mcp-server");
  await page
    .locator("summary")
    .filter({ hasText: "Browse the whole archive" })
    .click();
  await expect(page.locator("details ul li")).toHaveCount(88);
  await openMcp(page).click();
  await expect(page).toHaveURL(/\/work\/wandb-mcp-server$/);
  await context.close();
});
test("reduced motion and forced colors keep open/select/connect controls keyboard accessible", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await ready(page);
  await openMcp(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-window] h2")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(openMcp(page)).toBeFocused();
  await pair(page);
  await expect(
    page.getByRole("heading", { name: "A documented thread." }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
for (const zoom of [2, 4])
  test(`${zoom * 100}% zoom-equivalent reflow and mobile keyboard`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 1280 / zoom, height: 720 / zoom });
    await ready(page);
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    const question = page.getByLabel("Ask about the work", { exact: true });
    await question.fill("MCP");
    // Wait for the controlled input to enable submit before testing tab order.
    await expect(
      page.getByRole("button", { name: "Send question" }),
    ).toBeEnabled();
    // Native macOS WebKit uses Option-Tab for all controls unless the user's
    // Safari keyboard-navigation preference is enabled. Do not change that
    // machine preference or programmatically focus the button under test.
    await question.press(
      browserName === "webkit" && process.platform === "darwin"
        ? "Alt+Tab"
        : "Tab",
    );
    await expect(
      page.getByRole("button", { name: "Send question" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("log")).toContainText("MCP");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
