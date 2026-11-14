import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

// An isolated, read-only art review. Never turn this into a live Studio mode.
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const preview = spawn(process.execPath, [
  "node_modules/wrangler-e2e/bin/wrangler.js", "dev", "--config", "dist/server/wrangler.json",
  "--compatibility-date", "2026-07-28", "--port", "4199", "--inspector-port", "9199",
  "--ip", "127.0.0.1", "--local", "--log-level", "error", "--persist-to", ".wrangler/room-art-review",
  ...Object.entries({
    NODE_ENV: "development", DEPLOYMENT_TIER: "preview", PREVIEW_PR_NUMBER: "81",
    SITE_URL: "https://pr-81.anish-shah-is.online", PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview", RELEASE_VERSION: version,
    SIMULATION_EXPERIENCE_MODE: "disabled", SIMULATION_AI_MODE: "authored-only", TRAVEL_ATLAS_MODE: "atlas-v1",
  }).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
], { stdio: "inherit", env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/room-preview.log" } });
console.log("Room art preview: http://127.0.0.1:4199/play · synthetic data · Simulation disabled");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => preview.kill(signal));
preview.on("error", error => { console.error(error.message); process.exitCode = 1; });
preview.on("exit", code => { process.exitCode = code ?? 0; });
