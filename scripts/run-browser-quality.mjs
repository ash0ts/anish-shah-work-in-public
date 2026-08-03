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

function runPlaywright({ mode, port, segment = "", arguments_ = [] }) {
  const suffix = segment ? `-${segment}` : "";
  const relativeStateDirectory = `.wrangler/browser-quality-${mode}${suffix}`;
  const stateDirectory = path.join(root, relativeStateDirectory);
  rmSync(stateDirectory, { force: true, recursive: true });
  return run(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...arguments_],
    {
      BROWSER_PLAY_MODE: mode,
      BROWSER_QUALITY_PORT: String(port),
      BROWSER_QUALITY_SEGMENT: segment,
      BROWSER_QUALITY_STATE_DIR: relativeStateDirectory,
      ROOM_CAPTURE_VISUALS: "0",
    },
    { continueOnFailure: true },
  );
}

let failed = false;
if (runPlaywright({ mode: "classic", port: 4173 }) !== 0) failed = true;

if (runPlaywright({
  mode: "room",
  port: 4174,
  segment: "public",
  arguments_: ["tests/browser/public-quality.spec.mjs"],
}) !== 0) failed = true;

const roomShardCount = 5;
for (let shard = 1; shard <= roomShardCount; shard += 1) {
  if (runPlaywright({
    mode: "room",
    port: 4174 + shard,
    segment: `quality-shard-${shard}`,
    arguments_: [
      "tests/browser/room-quality.spec.mjs",
      "--fully-parallel",
      `--shard=${shard}/${roomShardCount}`,
    ],
  }) !== 0) failed = true;
}

if (
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
