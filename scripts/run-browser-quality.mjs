import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const declared = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
const required = [
  "@playwright/test",
  "@axe-core/playwright",
  "chrome-launcher",
  "lighthouse",
  "wrangler-e2e",
];
const missing = required.filter((dependency) => !declared[dependency]);
if (missing.length > 0) {
  throw new Error(
    `Browser-quality validation requires pinned direct dependencies: ${missing.join(", ")}.`,
  );
}

function run(binary, arguments_, environment = {}, { continueOnFailure = false } = {}) {
  const result = spawnSync(binary, arguments_, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (status !== 0 && !continueOnFailure) process.exit(status);
  return status;
}

function runPlaywright({ port, segment = "", arguments_ = [] }) {
  const suffix = segment ? `-${segment}` : "";
  const relativeStateDirectory = `.wrangler/browser-quality-room${suffix}`;
  const stateDirectory = path.join(root, relativeStateDirectory);
  rmSync(stateDirectory, { force: true, recursive: true });
  return run(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...arguments_],
    {
      BROWSER_QUALITY_PORT: String(port),
      BROWSER_QUALITY_SEGMENT: segment,
      BROWSER_QUALITY_STATE_DIR: relativeStateDirectory,
      ROOM_CAPTURE_VISUALS: "0",
    },
    { continueOnFailure: true },
  );
}

const scope = process.env.BROWSER_QUALITY_SCOPE?.trim() || "all";
const allowedScopes = new Set([
  "all",
  "room-public",
  "room-pr",
  "room-shard",
  "simulation",
  "travel",
  "lighthouse",
]);
if (!allowedScopes.has(scope)) {
  throw new Error(
    `BROWSER_QUALITY_SCOPE must be one of ${[...allowedScopes].join(", ")}.`,
  );
}

const configuredShard = process.env.BROWSER_QUALITY_SHARD?.trim() ?? "";
if (scope === "room-shard" && !/^[1-5]$/.test(configuredShard)) {
  throw new Error("BROWSER_QUALITY_SHARD must be an integer from 1 through 5.");
}
if (scope !== "room-shard" && configuredShard) {
  throw new Error(
    "BROWSER_QUALITY_SHARD is valid only when BROWSER_QUALITY_SCOPE=room-shard.",
  );
}

let failed = false;

if (
  (scope === "all" || scope === "room-public") &&
  runPlaywright({
    port: 4174,
    segment: "public",
    arguments_: ["tests/browser/public-quality.spec.mjs"],
  }) !== 0
) {
  failed = true;
}

if (
  (scope === "all" || scope === "travel") &&
  runPlaywright({
    port: 4181,
    segment: "travel",
    arguments_: ["tests/browser/travel-atlas.spec.mjs"],
  }) !== 0
) {
  failed = true;
}

if (scope === "all" || scope === "simulation") {
  if (
    runPlaywright({
      port: 4180,
      segment: "simulation-core",
      arguments_: [
        "tests/browser/simulation-quality.spec.mjs",
        "--grep-invert",
        "without JavaScript|room reveal",
      ],
    }) !== 0
  ) {
    failed = true;
  }
  if (
    runPlaywright({
      port: 4186,
      segment: "simulation-fallbacks",
      arguments_: [
        "tests/browser/simulation-quality.spec.mjs",
        "--grep",
        "without JavaScript|room reveal",
      ],
    }) !== 0
  ) {
    failed = true;
  }
}

const roomShardCount = 5;
const prRoomShardCount = 2;
const activeRoomShardCount = scope === "room-pr" ? prRoomShardCount : roomShardCount;
const firstRoomShard = scope === "room-shard" ? Number(configuredShard) : 1;
const lastRoomShard = scope === "room-shard" ? firstRoomShard : activeRoomShardCount;
if (scope === "all" || scope === "room-shard" || scope === "room-pr") {
  for (let shard = firstRoomShard; shard <= lastRoomShard; shard += 1) {
    if (
      runPlaywright({
        port: 4174 + shard,
        segment: `quality-shard-${shard}`,
        arguments_: [
          "tests/browser/room-quality.spec.mjs",
          "--fully-parallel",
          `--shard=${shard}/${activeRoomShardCount}`,
        ],
      }) !== 0
    ) {
      failed = true;
    }
  }
}

if (
  (scope === "all" || scope === "lighthouse") &&
  run(
    process.execPath,
    ["scripts/run-lighthouse-quality.mjs"],
    {},
    { continueOnFailure: true },
  ) !== 0
) {
  failed = true;
}

if (failed) process.exit(1);
