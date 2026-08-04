import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.mjs";

export default defineConfig({
  ...base,
  outputDir: ".playwright/results-spotify-webkit",
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [
        ["line"],
        [
          "html",
          {
            outputFolder: ".playwright/report-spotify-webkit",
            open: "never",
          },
        ],
      ]
    : "line",
  use: {
    ...base.use,
    ...devices["Desktop Safari"],
    browserName: "webkit",
    trace: "retain-on-failure",
  },
});
