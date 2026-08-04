import { spawnSync } from "node:child_process";

const worker = process.env.BROWSER_SOAK_WORKER?.trim() ?? "";
const loops = Number(process.env.BROWSER_SOAK_LOOPS ?? "5");
if (!/^[12]$/u.test(worker) || loops !== 5) {
  throw new Error("Browser soak requires worker 1 or 2 and exactly five loops.");
}

for (let iteration = 1; iteration <= loops; iteration += 1) {
  console.log(`Browser soak worker ${worker}: fresh process ${iteration} of ${loops}.`);
  const result = spawnSync(process.execPath, ["scripts/run-browser-quality.mjs"], {
    stdio: "inherit",
    env: { ...process.env, BROWSER_QUALITY_SCOPE: "room-pr" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

