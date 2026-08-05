import { spawnSync } from "node:child_process";

const worker = process.env.BROWSER_SOAK_WORKER?.trim() ?? "";
const loops = Number(process.env.BROWSER_SOAK_LOOPS ?? "1");
if (!/^[12]$/u.test(worker) || loops !== 1) {
  throw new Error("Browser soak requires worker 1 or 2 and exactly one exhaustive pass.");
}

const partition =
  worker === "1"
    ? {
        port: "4201",
        segment: "soak-desktop-travel",
        files: [
          "tests/browser/room-quality.spec.mjs",
          "tests/browser/travel-atlas.spec.mjs",
        ],
        pattern: [
          "twenty real drags never open an object",
          "twenty real Canvas pin clicks",
          "sustained slow completed fisheye frames",
        ].join("|"),
      }
    : {
        port: "4202",
        segment: "soak-pocket",
        files: ["tests/browser/room-quality.spec.mjs"],
        pattern: [
          "Pocket Room rejects twenty 3D swipe activations",
          "Pocket Room activates every object",
          "Pocket Room ignores idle gaps",
        ].join("|"),
      };

console.log(`Browser soak worker ${worker}: ${partition.segment}.`);
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    ...partition.files,
    "--grep",
    partition.pattern,
    "--workers=1",
    "--retries=0",
    "--max-failures=1",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      BROWSER_QUALITY_PORT: partition.port,
      BROWSER_QUALITY_SEGMENT: partition.segment,
      BROWSER_QUALITY_STATE_DIR: `.wrangler/browser-quality-${partition.segment}`,
      ROOM_CAPTURE_VISUALS: "0",
    },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
