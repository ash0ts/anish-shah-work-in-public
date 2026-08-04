import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COPY_PAGE_FILES,
  copyChangedPaths,
  copyRiskManifest,
  readCopyDeck,
} from "./lib/copy-deck.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentIndex = process.argv.indexOf("--base");
const requestedBase = argumentIndex >= 0 ? process.argv[argumentIndex + 1] : "origin/main";
if (!requestedBase || requestedBase.startsWith("-")) throw new Error("--base requires a Git ref.");

function git(...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

const mergeBase = git("merge-base", "HEAD", requestedBase).trim();
const changedPaths = copyChangedPaths(
  git("diff", "--name-only", `${mergeBase}...HEAD`, "--", "content/copy"),
  git("diff", "--name-only", "HEAD", "--", "content/copy"),
  git("ls-files", "--others", "--exclude-standard", "--", "content/copy"),
);
const current = await readCopyDeck(root);
const manifest = new Map((await copyRiskManifest(root)).map((field) => [field.key, field]));
const lines = [];

function oldFile(relativePath) {
  const result = spawnSync("git", ["show", `${mergeBase}:${relativePath}`], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout : null;
}

function parseLoose(source, marker) {
  if (source === null) return {};
  const values = {};
  let key = null;
  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    const heading = line.match(/^## ([a-z0-9]+(?:-[a-z0-9]+)*)$/u);
    if (heading) {
      key = heading[1];
      values[key] = "";
    } else if (key !== null && line !== marker) {
      values[key] += `${values[key] ? "\n" : ""}${line}`;
    }
  }
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.trim()]));
}

for (const relativePath of changedPaths.sort()) {
  const pageEntry = Object.entries(COPY_PAGE_FILES).find(([, file]) => file === relativePath);
  let currentValues;
  let oldValues;
  let prefix;
  if (pageEntry) {
    const [pageId] = pageEntry;
    currentValues = current.pages[pageId];
    oldValues = parseLoose(oldFile(relativePath), `<!-- copy-page: ${pageId} -->`);
    prefix = pageId;
  } else {
    const filename = path.basename(relativePath, ".md");
    const group = current.publicBundle.workGroups.find((candidate) => candidate.slug === filename);
    if (!group) continue;
    const source = await readFile(path.join(root, relativePath), "utf8");
    const marker = source.split("\n")[0];
    currentValues = Object.fromEntries(Object.entries(current.workGroups[group.id]).map(([name, value]) => [name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`), value]));
    oldValues = parseLoose(oldFile(relativePath), marker);
    prefix = group.id;
  }
  for (const key of new Set([...Object.keys(oldValues), ...Object.keys(currentValues)])) {
    if ((oldValues[key] ?? "") === (currentValues[key] ?? "")) continue;
    const entry = manifest.get(`${prefix}.${key}`);
    lines.push(`${entry?.risk === "fact_check" ? "FACT-CHECK" : "EDITORIAL"}  ${prefix}.${key}  ${entry?.route ?? "unknown"}  ${(oldValues[key] ?? "").length}→${(currentValues[key] ?? "").length}`);
  }
}

console.log(lines.length ? lines.join("\n") : "No copy-deck changes against the selected base.");
