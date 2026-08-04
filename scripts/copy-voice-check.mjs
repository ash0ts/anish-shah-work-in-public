import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCopyDeck,
  copyChangedPaths,
} from "./lib/copy-deck.mjs";
import {
  assertCopyVoice,
  auditCopyVoice,
  copyVoiceEntries,
  formatCopyVoiceIssue,
} from "./lib/copy-voice.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditMode = process.argv.includes("--audit");
const baseIndex = process.argv.indexOf("--base");
const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : "origin/main";
if (baseIndex >= 0 && (!base || base.startsWith("-"))) {
  throw new Error("--base requires a Git ref");
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
  return result.stdout;
}

if (auditMode) {
  const mergeBase = git("merge-base", "HEAD", base).trim();
  const changed = copyChangedPaths(
    git("diff", "--name-only", `${mergeBase}...HEAD`, "--", "content/copy"),
    git("diff", "--name-only", "HEAD", "--", "content/copy"),
    git("ls-files", "--others", "--exclude-standard", "--", "content/copy"),
  );
  console.log(
    `Copy audit · ${changed.length} copy file${changed.length === 1 ? "" : "s"} changed against ${base}`,
  );
}

const deck = await buildCopyDeck(root);
const report = auditCopyVoice(copyVoiceEntries(deck));
for (const warning of report.warnings) console.warn(formatCopyVoiceIssue(warning));
assertCopyVoice(report);
console.log(
  `Copy voice valid · ${Object.keys(deck.workGroups).length} WorkGroups · ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"} · ${deck.copyVersion}`,
);
