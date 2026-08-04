import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildCopyDeck,
  copyRiskManifest,
} from "./copy-deck.mjs";

export const COPY_ONLY_PACKAGE_SCHEMA_VERSION = "1.0";
export const COPY_ONLY_REPORT_SCHEMA_VERSION = "1.0";

const SHA = /^[a-f0-9]{40}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const PAGE_PATH = /^content\/copy\/pages\/(?:site|home|work|play|simulation|sources)\.md$/u;
const WORK_GROUP_PATH = /^content\/copy\/work-groups\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const MAX_COPY_FILE_BYTES = 64 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_COPY_FILES = 100;
const decoder = new TextDecoder("utf-8", { fatal: true });

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\n") !== wanted.join("\n")) {
    throw new Error(`${label} has an unexpected shape.`);
  }
}

function exactString(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function positiveInteger(value, label, maximum = 9_999_999) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function git(root, ...arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `git ${arguments_.join(" ")} failed.`,
    );
  }
  return result.stdout;
}

function safeRelativePath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    throw new Error("A copy artifact path is unsafe.");
  }
  const absolute = path.resolve(root, relativePath);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!absolute.startsWith(prefix)) {
    throw new Error("A copy artifact path escaped the repository.");
  }
  return absolute;
}

export function isEditableCopyPath(relativePath) {
  return PAGE_PATH.test(relativePath) || WORK_GROUP_PATH.test(relativePath);
}

function normalizedStatus(status) {
  if (status === "M" || status === "modified") return "modified";
  return "unsupported";
}

export function classifyCopyChanges(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { eligible: false, reason: "no_changed_files", paths: [] };
  }
  const paths = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { eligible: false, reason: "malformed_change", paths: [] };
    }
    const relativePath = entry.path ?? entry.filename;
    if (
      normalizedStatus(entry.status) !== "modified" ||
      !isEditableCopyPath(relativePath)
    ) {
      return {
        eligible: false,
        reason: "non_copy_or_structural_change",
        paths: [],
      };
    }
    paths.push(relativePath);
  }
  const unique = [...new Set(paths)].sort();
  if (unique.length !== paths.length || unique.length > MAX_COPY_FILES) {
    return { eligible: false, reason: "invalid_copy_file_set", paths: [] };
  }
  return { eligible: true, reason: "copy_only", paths: unique };
}

function parseGitNameStatus(value) {
  const fields = value.split("\0").filter(Boolean);
  if (fields.length % 2 !== 0) {
    throw new Error("Git returned an unreadable changed-file list.");
  }
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    entries.push({ status: fields[index], path: fields[index + 1] });
  }
  return entries;
}

function flattenDeck(deck) {
  const fields = new Map();
  for (const [page, values] of Object.entries(deck.pages)) {
    for (const [key, value] of Object.entries(values)) {
      fields.set(`${page}.${key}`, value);
    }
  }
  for (const [groupId, values] of Object.entries(deck.workGroups)) {
    for (const [key, value] of Object.entries(values)) {
      const sourceKey = key.replace(
        /[A-Z]/gu,
        (letter) => `-${letter.toLowerCase()}`,
      );
      fields.set(`${groupId}.${sourceKey}`, value);
    }
  }
  return fields;
}

async function changedFields(baseRoot, candidateRoot) {
  const [base, candidate, manifest] = await Promise.all([
    buildCopyDeck(baseRoot),
    buildCopyDeck(candidateRoot),
    copyRiskManifest(candidateRoot),
  ]);
  const before = flattenDeck(base);
  const after = flattenDeck(candidate);
  const risk = new Map(manifest.map((entry) => [entry.key, entry]));
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes = keys.flatMap((key) => {
    const previous = before.get(key) ?? "";
    const next = after.get(key) ?? "";
    if (previous === next) return [];
    const definition = risk.get(key);
    if (!definition) {
      throw new Error(`The copy field ${key} has no trusted risk definition.`);
    }
    return [{
      key,
      risk: definition.risk,
      route: definition.route,
      beforeLength: previous.length,
      afterLength: next.length,
    }];
  });
  if (changes.length === 0) {
    throw new Error("The copy-only change does not alter any declared copy field.");
  }
  return {
    copyVersion: candidate.copyVersion,
    changes,
    affectedRoutes: [...new Set(changes.map((change) => change.route))].sort(),
  };
}

async function regularUtf8File(root, relativePath) {
  const absolute = safeRelativePath(root, relativePath);
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${relativePath} must be a regular file.`);
  }
  if (stat.size < 1 || stat.size > MAX_COPY_FILE_BYTES) {
    throw new Error(`${relativePath} exceeds the copy-only file budget.`);
  }
  const bytes = await readFile(absolute);
  decoder.decode(bytes);
  return bytes;
}

function exactBlobAt(root, revision, relativePath) {
  return Buffer.from(
    git(root, "show", `${revision}:${relativePath}`),
    "utf8",
  );
}

function requireOrdinaryBlob(root, revision, relativePath) {
  const row = git(root, "ls-tree", revision, "--", relativePath).trim();
  const match = row.match(/^100644 blob [a-f0-9]{40}\t(.+)$/u);
  if (!match || match[1] !== relativePath) {
    throw new Error(`${relativePath} must remain an ordinary non-executable Git blob.`);
  }
}

export async function createCopyOnlyPackage({
  candidateRoot,
  baseRoot,
  baseSha,
  headSha,
  repository,
  prNumber,
}) {
  exactString(baseSha, SHA, "base SHA");
  exactString(headSha, SHA, "head SHA");
  exactString(repository, REPOSITORY, "repository");
  positiveInteger(prNumber, "pull request number");
  if (git(candidateRoot, "rev-parse", "HEAD").trim() !== headSha) {
    throw new Error("The candidate checkout does not match the PR head SHA.");
  }
  if (git(baseRoot, "rev-parse", "HEAD").trim() !== baseSha) {
    throw new Error("The base checkout does not match the PR base SHA.");
  }
  if (
    git(candidateRoot, "status", "--porcelain=v1", "--untracked-files=all").trim() ||
    git(baseRoot, "status", "--porcelain=v1", "--untracked-files=all").trim()
  ) {
    throw new Error("Copy-only packaging requires clean checkouts.");
  }

  const mergeBaseSha = git(candidateRoot, "merge-base", baseSha, headSha).trim();
  exactString(mergeBaseSha, SHA, "merge-base SHA");
  const classification = classifyCopyChanges(
    parseGitNameStatus(
      git(
        candidateRoot,
        "diff",
        "--name-status",
        "--no-renames",
        "-z",
        mergeBaseSha,
        headSha,
      ),
    ),
  );
  if (!classification.eligible) return classification;

  const files = [];
  let totalBytes = 0;
  for (const relativePath of classification.paths) {
    requireOrdinaryBlob(candidateRoot, headSha, relativePath);
    const targetBase = exactBlobAt(candidateRoot, baseSha, relativePath);
    const commonBase = exactBlobAt(candidateRoot, mergeBaseSha, relativePath);
    if (!targetBase.equals(commonBase)) {
      throw new Error(
        `${relativePath} changed on the base branch; update the copy branch before previewing.`,
      );
    }
    const bytes = await regularUtf8File(candidateRoot, relativePath);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error("The copy-only package exceeds its total byte budget.");
    }
    files.push({
      path: relativePath,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      contentBase64: bytes.toString("base64"),
    });
  }

  const presentation = await changedFields(baseRoot, candidateRoot);
  return {
    eligible: true,
    package: {
      schemaVersion: COPY_ONLY_PACKAGE_SCHEMA_VERSION,
      repository,
      pullRequestNumber: prNumber,
      baseSha,
      mergeBaseSha,
      headSha,
      copyVersion: presentation.copyVersion,
      files,
      changes: presentation.changes,
      affectedRoutes: presentation.affectedRoutes,
    },
  };
}

function validateChange(change) {
  exactKeys(
    change,
    ["key", "risk", "route", "beforeLength", "afterLength"],
    "copy change",
  );
  if (
    typeof change.key !== "string" ||
    !/^[a-z0-9:-]+(?:\.[a-z0-9-]+)+$/u.test(change.key) ||
    !new Set(["editorial", "fact_check"]).has(change.risk) ||
    typeof change.route !== "string" ||
    !(
      change.route === "all-public-routes" ||
      change.route === "all-play-routes" ||
      /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/u.test(change.route)
    ) ||
    !Number.isInteger(change.beforeLength) ||
    change.beforeLength < 0 ||
    change.beforeLength > 20_000 ||
    !Number.isInteger(change.afterLength) ||
    change.afterLength < 0 ||
    change.afterLength > 20_000
  ) {
    throw new Error("A copy change entry is invalid.");
  }
  return change;
}

function decodePackageFile(file) {
  exactKeys(
    file,
    ["path", "byteLength", "sha256", "contentBase64"],
    "copy package file",
  );
  if (!isEditableCopyPath(file.path)) {
    throw new Error("A copy package contains a forbidden path.");
  }
  if (
    !Number.isInteger(file.byteLength) ||
    file.byteLength < 1 ||
    file.byteLength > MAX_COPY_FILE_BYTES ||
    typeof file.contentBase64 !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      file.contentBase64,
    ) ||
    !HASH.test(file.sha256)
  ) {
    throw new Error("A copy package file is malformed.");
  }
  const bytes = Buffer.from(file.contentBase64, "base64");
  if (
    bytes.byteLength !== file.byteLength ||
    bytes.toString("base64") !== file.contentBase64 ||
    sha256(bytes) !== file.sha256
  ) {
    throw new Error("A copy package file failed integrity validation.");
  }
  decoder.decode(bytes);
  return { path: file.path, bytes };
}

export function parseCopyOnlyPackage(value, expected) {
  exactKeys(
    value,
    [
      "schemaVersion",
      "repository",
      "pullRequestNumber",
      "baseSha",
      "mergeBaseSha",
      "headSha",
      "copyVersion",
      "files",
      "changes",
      "affectedRoutes",
    ],
    "copy-only package",
  );
  if (value.schemaVersion !== COPY_ONLY_PACKAGE_SCHEMA_VERSION) {
    throw new Error("The copy-only package schema is unsupported.");
  }
  exactString(value.repository, REPOSITORY, "package repository");
  positiveInteger(value.pullRequestNumber, "package pull request number");
  exactString(value.baseSha, SHA, "package base SHA");
  exactString(value.mergeBaseSha, SHA, "package merge-base SHA");
  exactString(value.headSha, SHA, "package head SHA");
  exactString(value.copyVersion, /^[a-f0-9]{16}$/u, "package COPY_VERSION");
  if (
    value.repository.toLowerCase() !== expected.repository.toLowerCase() ||
    value.pullRequestNumber !== expected.prNumber ||
    value.baseSha !== expected.baseSha ||
    value.headSha !== expected.headSha
  ) {
    throw new Error("The copy-only package does not match the current pull request.");
  }
  if (
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > MAX_COPY_FILES ||
    !Array.isArray(value.changes) ||
    value.changes.length < 1 ||
    value.changes.length > 1_000 ||
    !Array.isArray(value.affectedRoutes) ||
    value.affectedRoutes.length < 1 ||
    value.affectedRoutes.length > 100
  ) {
    throw new Error("The copy-only package collections are invalid.");
  }
  const files = value.files.map(decodePackageFile);
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error("The copy-only package repeats a path.");
  }
  const changes = value.changes.map(validateChange);
  if (new Set(changes.map((change) => change.key)).size !== changes.length) {
    throw new Error("The copy-only package repeats a copy key.");
  }
  const affectedRoutes = [...new Set(changes.map((change) => change.route))].sort();
  if (
    value.affectedRoutes.some((route) => typeof route !== "string") ||
    JSON.stringify(value.affectedRoutes) !== JSON.stringify(affectedRoutes)
  ) {
    throw new Error("The copy-only package route report is inconsistent.");
  }
  return { ...value, files, changes, affectedRoutes };
}

export async function applyCopyOnlyPackage({
  packagePath,
  baseRoot,
  expected,
  reportPath,
}) {
  const packageStat = await lstat(packagePath);
  if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
    throw new Error("The downloaded copy-only package must be a regular file.");
  }
  const packageBytes = await readFile(packagePath);
  if (packageBytes.byteLength < 2 || packageBytes.byteLength > MAX_PACKAGE_BYTES * 2) {
    throw new Error("The copy-only package has an invalid size.");
  }
  let raw;
  try {
    raw = JSON.parse(decoder.decode(packageBytes));
  } catch {
    throw new Error("The copy-only package is not valid UTF-8 JSON.");
  }
  const parsed = parseCopyOnlyPackage(raw, expected);
  if (git(baseRoot, "rev-parse", "HEAD").trim() !== parsed.baseSha) {
    throw new Error("The trusted base checkout does not match the package.");
  }
  if (git(baseRoot, "status", "--porcelain=v1", "--untracked-files=all").trim()) {
    throw new Error("The trusted base checkout must be clean before applying copy.");
  }
  for (const file of parsed.files) {
    const absolute = safeRelativePath(baseRoot, file.path);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${file.path} is not a regular base-branch copy file.`);
    }
    await writeFile(absolute, file.bytes, { mode: 0o644 });
  }
  const presentation = await changedFields(
    expected.pristineBaseRoot ?? expected.baseRoot,
    baseRoot,
  );
  if (
    presentation.copyVersion !== parsed.copyVersion ||
    JSON.stringify(presentation.changes) !== JSON.stringify(parsed.changes) ||
    JSON.stringify(presentation.affectedRoutes) !==
      JSON.stringify(parsed.affectedRoutes)
  ) {
    throw new Error("The trusted copy result does not match the validated package report.");
  }
  const changedPaths = git(baseRoot, "diff", "--name-only", "HEAD", "--")
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  const packagePaths = parsed.files.map((file) => file.path).sort();
  if (JSON.stringify(changedPaths) !== JSON.stringify(packagePaths)) {
    throw new Error("Applying the copy package changed an unexpected path.");
  }
  const report = {
    schemaVersion: COPY_ONLY_REPORT_SCHEMA_VERSION,
    repository: parsed.repository,
    pullRequestNumber: parsed.pullRequestNumber,
    baseSha: parsed.baseSha,
    headSha: parsed.headSha,
    copyVersion: parsed.copyVersion,
    changedFiles: packagePaths,
    changes: parsed.changes,
    affectedRoutes: parsed.affectedRoutes,
  };
  await mkdir(path.dirname(reportPath), { recursive: true, mode: 0o700 });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  return report;
}

export function copyPreviewComment({ report, previewUrl, screenshot }) {
  exactString(previewUrl, /^https:\/\/pr-[1-9][0-9]{0,6}\.anish-shah-is\.online$/u, "preview URL");
  const editorial = report.changes
    .filter((change) => change.risk === "editorial")
    .map((change) => change.key);
  const factCheck = report.changes
    .filter((change) => change.risk === "fact_check")
    .map((change) => change.key);
  const visible = (values) => {
    const shown = values.slice(0, 40).map((value) => `\`${value}\``).join(", ");
    return values.length > 40 ? `${shown} … +${values.length - 40} more` : shown || "None";
  };
  const routes = report.affectedRoutes.map((route) => `\`${route}\``).join(", ");
  return [
    "<!-- anish-site-preview -->",
    `Copy preview: ${previewUrl}`,
    "",
    `Validated copy SHA: \`${report.headSha}\``,
    `Base code SHA: \`${report.baseSha}\``,
    `COPY_VERSION: \`${report.copyVersion}\``,
    "Data: synthetic; no production connector or Studio access.",
    "Validation: passed using trusted base-branch code.",
    `Screenshots: ${screenshot.status} (${screenshot.captured}/${screenshot.total} affected route-viewports).`,
    "",
    `Editorial keys: ${visible(editorial)}`,
    `Fact-check keys: ${visible(factCheck)}`,
    `Affected routes: ${routes}`,
  ].join("\n");
}
