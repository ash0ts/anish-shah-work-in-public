import { defineConfig, devices } from "@playwright/test";

const playMode = process.env.BROWSER_PLAY_MODE === "room" ? "room" : "classic";
const port = playMode === "room" ? 4174 : 4173;
const baseURL = `http://127.0.0.1:${port}`;
const persistedState =
  process.env.BROWSER_QUALITY_STATE_DIR ??
  `.wrangler/browser-quality-${playMode}`;
const experienceMode = playMode === "room" ? "my-room-2001" : "classic";
const previewRuntimeVariables =
  playMode === "room"
    ? " --var DEPLOYMENT_TIER:preview --var PREVIEW_PR_NUMBER:1 --var SITE_URL:https://pr-1.anish-shah-is.online --var PRODUCTION_SITE_URL:https://anish-shah-is.online --var PUBLIC_CONTENT_MODE:static_preview"
    : "";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: `.playwright/results-${playMode}`,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ["line"],
        [
          "html",
          {
            outputFolder: `.playwright/report-${playMode}`,
            open: "never",
          },
        ],
      ]
    : "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "en-US",
    colorScheme: "light",
    launchOptions: {
      args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
    },
    trace: "retain-on-failure",
    video:
      process.env.ROOM_CAPTURE_VISUALS === "1"
        ? { mode: "on", size: { width: 1440, height: 900 } }
        : "off",
  },
  webServer: {
    command:
      `WRANGLER_LOG_PATH=.wrangler/browser-quality-${playMode}.log node node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --port ${port} --ip 127.0.0.1 --local --var NODE_ENV:development --var PLAY_EXPERIENCE_MODE:${experienceMode}${previewRuntimeVariables} --log-level error --persist-to ${persistedState}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
