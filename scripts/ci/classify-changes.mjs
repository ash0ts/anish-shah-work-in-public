import { appendFile, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  classifyCiChanges,
  pathsFromPullRequestFiles,
} from "../lib/ci-change-classifier.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) return "";
  return process.argv[index + 1];
}

const base = option("--base");
const head = option("--head");
const outputPath = option("--output");
const githubOutput = option("--github-output");
const changesFile = option("--changes-file");
const usesChangesFile = Boolean(changesFile);
const usesGitRange = Boolean(base || head);
if (usesChangesFile === usesGitRange) {
  throw new Error("Use exactly one of --changes-file or --base/--head.");
}

let paths;
if (usesChangesFile) {
  const bytes = await readFile(changesFile);
  if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
    throw new Error("Pull-request file metadata is empty or oversized.");
  }
  paths = pathsFromPullRequestFiles(JSON.parse(bytes.toString("utf8")));
} else {
  if (!/^[a-f0-9]{40}$/u.test(base) || !/^[a-f0-9]{40}$/u.test(head)) {
    throw new Error("--base and --head must be full lowercase commit SHAs.");
  }
  const diff = spawnSync(
    "git",
    [
      "diff",
      "--name-only",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "-z",
      base,
      head,
      "--",
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (diff.error || diff.status !== 0) {
    throw diff.error ?? new Error(diff.stderr || "git diff failed.");
  }
  paths = diff.stdout.split("\0").filter(Boolean);
}
const result = classifyCiChanges(paths);
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized, { mode: 0o600 });
if (githubOutput) {
  const lines = [
    `lane=${result.lane}`,
    `requires_build=${result.requiresBuild}`,
    `requires_codeql=${result.requiresCodeql}`,
    `browser_scopes=${JSON.stringify(result.browserScopes)}`,
  ];
  await appendFile(githubOutput, `${lines.join("\n")}\n`);
}
if (!outputPath && !githubOutput) process.stdout.write(serialized);
