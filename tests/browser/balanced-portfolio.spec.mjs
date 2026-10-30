import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("the illustrated overview opens each work type without another navigation layer", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const overview = page.locator("[data-work-overview]");
  await expect(overview.getByRole("link")).toHaveCount(4);
  const entries = await overview.getByRole("link").evaluateAll(links =>
    links.map(link => ({ label: link.textContent.replace("↗", "").trim(), href: link.getAttribute("href") })),
  );
  for (const entry of entries) {
    expect(entry.href).toMatch(/^\/work\?bucket=[a-z-]+#work-index$/);
    await page.goto(entry.href, { waitUntil: "networkidle" });
    await expect(page.locator("#work-index-title")).toHaveText(entry.label);
    expect(await page.locator("[data-work-id]").count()).toBeGreaterThan(0);
  }
});

test("calendar headings filter the active scope while mobile year navigation only browses", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/work", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Show previous year" }).click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.locator("#work-index")).toHaveCount(0);
  const year = page.locator('[data-timeline-year="2025"] a');
  await expect(year).toBeVisible();
  await year.click();
  await expect(page).toHaveURL(/year=2025#work-index$/);
  await expect(page.locator("#work-index-title")).toBeFocused();
  await page.getByRole("combobox", { name: "Topic", exact: true }).selectOption("agent-systems");
  await page.getByRole("searchbox").fill("agent");
  await page.getByRole("button", { name: /^Filters/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Work type" }).selectOption("products-open-source");
  await dialog.getByRole("button", { name: "Show work" }).click();
  const selected = new URL(page.url());
  expect(selected.searchParams.get("year")).toBe("2025");
  expect(selected.searchParams.get("topic")).toBe("agent-systems");
  expect(selected.searchParams.get("q")).toBe("agent");
  expect(selected.searchParams.get("bucket")).toBe("products-open-source");
  await page.goBack();
  await expect(page).toHaveURL(/year=2025#work-index$/);
  await page.goForward();
  await expect(page.locator("#work-index-title")).toBeVisible();
  await expect(page.locator('[data-timeline-year="2024"] a')).toHaveAttribute(
    "href", /q=agent.*bucket=products-open-source.*topic=agent-systems.*year=2024.*#work-index/,
  );
  await page.getByRole("link", { name: "Remove Software & tools work type filter" }).click();
  await expect(page).toHaveURL(url => !url.searchParams.has("bucket"));
  const cleared = new URL(page.url());
  expect(cleared.searchParams.has("bucket")).toBe(false);
  expect(cleared.searchParams.get("q")).toBe("agent");
  expect(cleared.searchParams.get("topic")).toBe("agent-systems");
  expect(cleared.searchParams.get("year")).toBe("2025");
});

test("Home, Work, and the speaker utility fit every reviewed width", async ({ page }) => {
  test.setTimeout(90_000);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/work", "/work?bucket=products-open-source", "/about"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route + " at " + width).toBeLessThanOrEqual(width + 1);
      if (route === "/about") {
        await expect(page.locator("#speaker-profile")).not.toHaveAttribute("open", "");
        await page.locator("#speaker-profile > summary").click();
        await expect(page.getByText("Anish Shah builds agent infrastructure", { exact: false })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      }
      if (process.env.BALANCED_CAPTURE === "1" && [390, 1440].includes(width)) {
        await page.screenshot({ path: `.playwright/balanced-review/${width}-${route.replace(/[^a-z0-9]/gi, "-") || "home"}.png`, fullPage: true });
      }
    }
  }
});

test("overview and organizer disclosure work with keyboard and forced colors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  for (const route of ["/", "/work", "/about"]) {
    await page.goto(route, { waitUntil: "networkidle" });
    if (route === "/about") {
      const summary = page.locator("#speaker-profile > summary");
      await summary.focus();
      await summary.press("Enter");
      await expect(page.locator("#speaker-profile")).toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test("the affected pages reflow at 200% and 400% equivalent viewport scales", async ({ browser }) => {
  test.setTimeout(60_000);
  // A 1280px window at browser zoom yields 640/320 CSS pixels. DPR preserves
  // the physical raster size; this checks reflow, not assistive-technology output.
  for (const scale of [2, 4]) {
    const context = await browser.newContext({
      viewport: { width: 1280 / scale, height: 960 / scale },
      deviceScaleFactor: scale,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const route of ["/", "/work?bucket=products-open-source&year=2026", "/about#speaker-title"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      expect(overflow.content, `${route} at ${scale * 100}% reflow`).toBeLessThanOrEqual(overflow.width + 1);
      if (route.startsWith("/about")) {
        await expect(page.locator("#speaker-profile")).toHaveAttribute("open", "");
        await page.getByRole("button", { name: "Copy speaker profile" }).focus();
        await expect(page.getByRole("button", { name: "Copy speaker profile" })).toBeFocused();
      }
    }
    await context.close();
  }
});
