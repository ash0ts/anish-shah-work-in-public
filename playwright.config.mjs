import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;

// Keep the browser-only runtime current enough to handle refused request bodies
// without terminating ProxyController. Preserve the existing compatibility
// date so updating this test tool does not change the Worker feature contract.
const e2eCompatibilityDate = "2026-07-28";
const playMode = "room";
const defaultPort = 4174;
const configuredPort = process.env.BROWSER_QUALITY_PORT?.trim();
if (configuredPort && !/^\d{4,5}$/.test(configuredPort)) {
  throw new Error("BROWSER_QUALITY_PORT must be a valid loopback port.");
}
const port = configuredPort ? Number(configuredPort) : defaultPort;
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("BROWSER_QUALITY_PORT must be between 1024 and 65535.");
}
// Release Browser Quality runs two isolated Wrangler previews concurrently.
// Wrangler otherwise gives every process the same 9229 inspector port, which
// makes the second preview fail before any product test can start.
const inspectorPort = port + 5_000;
if (inspectorPort > 65_535) {
  throw new Error("BROWSER_QUALITY_PORT is too high to derive an inspector port.");
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
const simulationExperienceMode =
  process.env.BROWSER_SIMULATION_EXPERIENCE_MODE?.trim() || "disabled";
if (!new Set(["disabled", "campaign-v1"]).has(simulationExperienceMode)) {
  throw new Error(
    "BROWSER_SIMULATION_EXPERIENCE_MODE must be disabled or campaign-v1.",
  );
}
const simulationAiMode =
  simulationExperienceMode === "campaign-v1" ? "fixture" : "authored-only";
const previewRuntimeVariables =
  ` --var DEPLOYMENT_TIER:preview --var PREVIEW_PR_NUMBER:1 --var SITE_URL:https://pr-1.anish-shah-is.online --var PRODUCTION_SITE_URL:https://anish-shah-is.online --var PUBLIC_CONTENT_MODE:static_preview --var RELEASE_VERSION:${packageVersion} --var SIMULATION_EXPERIENCE_MODE:${simulationExperienceMode} --var SIMULATION_AI_MODE:${simulationAiMode} --var SIMULATION_PROVIDER:fixture --var SIMULATION_MODEL:authored-fixture-v1 --var TRAVEL_ATLAS_MODE:atlas-v1`;

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
      `WRANGLER_LOG_PATH=.wrangler/browser-quality-${playMode}${artifactSuffix}.log node node_modules/wrangler-e2e/bin/wrangler.js dev --config dist/server/wrangler.json --compatibility-date ${e2eCompatibilityDate} --port ${port} --inspector-port ${inspectorPort} --ip 127.0.0.1 --local --var NODE_ENV:development${previewRuntimeVariables} --log-level error --persist-to ${persistedState}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
