import { spawnSync } from "node:child_process";

const raw = process.env.CI_BROWSER_SCOPES?.trim() ?? "";
let scopes;
try {
  scopes = JSON.parse(raw);
} catch {
  throw new Error("CI_BROWSER_SCOPES must be a JSON array.");
}
const allowed = new Set(["public", "room-smoke", "simulation", "travel"]);
if (
  !Array.isArray(scopes) ||
  scopes.length === 0 ||
  scopes.length > allowed.size ||
  scopes.some((scope) => !allowed.has(scope)) ||
  new Set(scopes).size !== scopes.length
) {
  throw new Error("CI_BROWSER_SCOPES contains an invalid browser scope set.");
}

for (const scope of scopes) {
  const result = spawnSync(process.execPath, ["scripts/run-browser-quality.mjs"], {
    stdio: "inherit",
    env: { ...process.env, BROWSER_QUALITY_SCOPE: scope },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
