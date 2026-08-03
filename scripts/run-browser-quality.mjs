import { spawnSync } from "node:child_process";
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

function run(binary, arguments_) {
  const result = spawnSync(binary, arguments_, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["node_modules/@playwright/test/cli.js", "test"]);
run(process.execPath, ["scripts/run-lighthouse-quality.mjs"]);
