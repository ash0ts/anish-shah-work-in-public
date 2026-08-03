import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: ".playwright/results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: ".playwright/report", open: "never" }]] : "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "en-US",
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --port 4173 --ip 127.0.0.1 --local --var NODE_ENV:development --log-level error --persist-to .wrangler/browser-quality",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
