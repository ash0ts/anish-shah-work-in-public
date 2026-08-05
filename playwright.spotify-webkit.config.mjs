import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.mjs";

// The shared Chromium project forces SwiftShader with Chromium-only command
// line flags. A native Linux WebKit build rejects those flags before it opens a
// page, so carry over the browser-neutral defaults only.
const sharedUse = { ...base.use };
Reflect.deleteProperty(sharedUse, "launchOptions");

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
    ...sharedUse,
    ...devices["Desktop Safari"],
    browserName: "webkit",
    trace: "retain-on-failure",
  },
});
