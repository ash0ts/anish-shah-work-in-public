import { test, expect } from "@playwright/test";

// Manual, opt-in check only. Never put an owner's generated feed token in Git.
// Synthetic previews normally prohibit frames. This isolated test applies the
// production frame allowlist to the local response, without changing deployment.
test("owner-supplied Strava feed renders only after consent", async ({ page }, testInfo) => {
  const embed = process.env.STRAVA_TEST_EMBED;
  test.skip(!embed, "Supply a freshly generated official profile embed for a manual check.");
  expect(embed).toMatch(/^https:\/\/www\.strava\.com\/athletes\/[1-9]\d{0,19}\/(latest-rides|activity-summary)\/[a-f0-9]{40}$/i);
  const requests = [];
  page.on("request", request => { if (new URL(request.url()).hostname.endsWith("strava.com")) requests.push(request.url()); });
  await page.route("**/play/move?fixture=ready", async route => {
    const response = await route.fetch();
    const original = await response.text();
    const body = original.replace(/https:\/\/www\.strava\.com\/athletes\/99999999999999999999\/latest-rides\/[a-f0-9]{40}/gi, embed);
    expect(body).not.toBe(original);
    const headers = { ...response.headers() };
    headers["content-security-policy"] = headers["content-security-policy"].replace("frame-src 'none'", "frame-src https://www.strava.com https://strava-embeds.com");
    await route.fulfill({ response, body, headers });
  });
  await page.goto("/play/move?fixture=ready", { waitUntil: "networkidle" });
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Load public Strava feed" }).click();
  const frame = page.locator('iframe[title*="Strava"]');
  await expect(frame).toHaveAttribute("src", embed);
  await frame.scrollIntoViewIfNeeded();
  await expect.poll(() => requests.includes(embed)).toBe(true);
  await expect(page.frameLocator('iframe[title*="Strava"]').locator("body")).not.toBeEmpty({ timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath("consented-feed.png"), fullPage: true });
  // Screenshot review is required; HTTP success/nonempty HTML is not visual success.
});
