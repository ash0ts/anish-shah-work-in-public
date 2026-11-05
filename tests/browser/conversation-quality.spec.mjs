import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("conversation preview is sourced, quiet, and never sends questions to a provider or URL", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/simulation");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Something here remembers the work.",
  );
  await expect(page.locator("[data-scene]")).toHaveAttribute(
    "data-scene",
    "desk",
  );
  await expect(page.getByLabel("Ask about the work")).toBeEnabled();
  const before = requests.length;
  await page.getByLabel("Ask about the work").fill("MCP tool interfaces");
  await page.getByRole("button", { name: "Ask 4N1SH" }).click();
  await expect(
    page
      .getByRole("region", { name: "Conversation", exact: true })
      .getByRole("status"),
  ).toContainText("Sources found.");
  expect(page.url()).not.toContain("MCP");
  expect(
    requests
      .slice(before)
      .filter((url) =>
        /api\/simulation|generativelanguage|googleapis/.test(url),
      ),
  ).toEqual([]);
  for (const index of [0, 1, 2]) {
    const evidence = page
      .locator("#conversation-results li details")
      .nth(index);
    await evidence.locator("summary").click();
    await expect(
      page
        .getByRole("region", { name: "Conversation", exact: true })
        .getByRole("status"),
    ).toContainText("Sources found.");
  }
  await expect(page.locator("[data-scene]")).toHaveAttribute(
    "data-scene",
    "doorway",
  );
  await expect(
    page.getByRole("heading", { name: "The door leads back to the work." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Still presentation" }).click();
  await expect(page.locator("[data-scene]")).toHaveAttribute(
    "data-still",
    "true",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`conversation fits ${width}px without horizontal scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/simulation");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.playwright/conversation-${width}.png`,
      fullPage: true,
    });
  });
}
test("no-JavaScript discovery links retain evidence and no free-text GET form", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/simulation");
  await expect(page.getByLabel("Ask about the work")).toBeDisabled();
  await page.getByRole("link", { name: "MCP tool interfaces" }).click();
  await expect(page.locator("#conversation-results")).toContainText("MCP");
  expect(page.url()).toContain("inspect=");
  expect(page.url()).not.toContain("q=");
  await context.close();
});
test("forced colors and reduced motion retain the full semantic conversation", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/simulation");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page
    .getByRole("link", { name: "Evaluation and failure analysis" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Conversation", exact: true })
      .getByRole("status"),
  ).toContainText("Sources found.");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const zoom of [2, 4]) {
  test(`conversation supports ${zoom * 100}% zoom-equivalent reflow with keyboard controls`, async ({ page }) => {
    // Browser zoom reduces the CSS viewport. CSS `zoom` alone does not trigger
    // viewport media queries, so test the equivalent 1280px viewport reduction.
    await page.setViewportSize({ width: 1280 / zoom, height: 900 / zoom });
    await page.goto("/simulation");
    const still = page.getByRole("button", { name: "Still presentation" });
    await still.focus();
    await page.keyboard.press("Enter");
    await expect(still).toBeFocused();
    await expect(page.locator("[data-scene]")).toHaveAttribute("data-still", "true");
    const question = page.getByLabel("Ask about the work");
    await question.focus();
    await question.fill("MCP tool interfaces");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Ask 4N1SH" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Conversation", exact: true }).getByRole("status")).toContainText("Sources found.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
