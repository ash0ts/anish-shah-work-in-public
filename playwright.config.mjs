import { defineConfig, devices } from "@playwright/test";

const playMode = process.env.BROWSER_PLAY_MODE === "room" ? "room" : "classic";
const defaultPort = playMode === "room" ? 4174 : 4173;
const configuredPort = process.env.BROWSER_QUALITY_PORT?.trim();
if (configuredPort && !/^\d{4,5}$/.test(configuredPort)) {
  throw new Error("BROWSER_QUALITY_PORT must be a valid loopback port.");
}
const port = configuredPort ? Number(configuredPort) : defaultPort;
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("BROWSER_QUALITY_PORT must be between 1024 and 65535.");
}
const segment = process.env.BROWSER_QUALITY_SEGMENT?.trim() ?? "";
if (segment && !/^[a-z0-9-]{1,48}$/.test(segment)) {
  throw new Error("BROWSER_QUALITY_SEGMENT contains unexpected characters.");
}
const artifactSuffix = segment ? `-${segment}` : "";
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
  outputDir: `.playwright/results-${playMode}${artifactSuffix}`,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ["line"],
        [
          "html",
          {
            outputFolder: `.playwright/report-${playMode}${artifactSuffix}`,
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
      `WRANGLER_LOG_PATH=.wrangler/browser-quality-${playMode}${artifactSuffix}.log node node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --port ${port} --ip 127.0.0.1 --local --var NODE_ENV:development --var PLAY_EXPERIENCE_MODE:${experienceMode}${previewRuntimeVariables} --log-level error --persist-to ${persistedState}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
