#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifyAttestedArtifacts } from "./content-attestation-policy.mjs";
import { scanSensitiveContent } from "./sensitive-content.mjs";

const HELP = `Usage: node check-change.mjs [--plan | --run | --full] [--path <repo-relative-path>]...

  --plan   Print guardrails and selected checks (default).
  --run    Run checks selected from changed paths.
  --full   Run the complete repository validation gate.
  --path   Classify an explicit safe fixture path instead of reading git state.
`;

function fail(message) {
  console.error(message);
  process.exit(2);
}

let mode = "plan";
let explicitMode = false;
const fixturePaths = [];
const argumentsList = process.argv.slice(2);
for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--help" || argument === "-h") {
    console.log(HELP);
    process.exit(0);
  }
  if (["--plan", "--run", "--full"].includes(argument)) {
    if (explicitMode) fail("Choose only one of --plan, --run, or --full.");
    explicitMode = true;
    mode = argument.slice(2);
    continue;
  }
  if (argument === "--path") {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) fail("--path requires a value.");
    fixturePaths.push(value);
    index += 1;
    continue;
  }
  fail(`Unknown argument: ${argument}`);
}

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    fail(result.stderr.trim() || `git ${args.join(" ")} failed.`);
  }
  return result;
}

const root = runGit(["rev-parse", "--show-toplevel"]).stdout.trim();
if (!root) fail("Run this helper inside the anish-site Git repository.");

function normalizeRelativePath(value) {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (
    !normalized ||
    normalized === "." ||
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    fail(`Path must stay inside the repository: ${value}`);
  }
  return normalized.replace(/^\.\//, "");
}

function lines(result) {
  return result.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

function changedPaths() {
  if (fixturePaths.length) return fixturePaths.map(normalizeRelativePath);
  const values = [
    ...lines(runGit(["diff", "--name-only", "--diff-filter=ACMRD"])),
    ...lines(runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMRD"])),
    ...lines(runGit(["ls-files", "--others", "--exclude-standard"])),
  ];
  return values.map(normalizeRelativePath);
}

function deletedPaths() {
  if (fixturePaths.length) return new Set();
  return new Set(
    [
      ...lines(runGit(["diff", "--name-only", "--diff-filter=D"])),
      ...lines(runGit(["diff", "--cached", "--name-only", "--diff-filter=D"])),
    ].map(normalizeRelativePath),
  );
}

const paths = [...new Set(changedPaths())].sort();
const deleted = deletedPaths();
const trackedPaths = lines(runGit(["ls-files"])).map(normalizeRelativePath);
const violations = [];
const warnings = [];
const notes = [];

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function existsInHead(value) {
  return (
    runGit(["cat-file", "-e", `HEAD:${value}`], { allowFailure: true }).status ===
    0
  );
}

function isSensitivePath(value) {
  const base = path.posix.basename(value);
  if (value === "content/private/.gitignore") return false;
  return (
    (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) ||
    value === ".wrangler" ||
    value.startsWith(".wrangler/") ||
    value === "content/private" ||
    value.startsWith("content/private/") ||
    /(?:^|\/)anish-content\.v1\.json$/i.test(value) ||
    /(?:^|\/)anish_shah_(?:impact|public_footprint)[^/]*\.(?:csv|md)$/i.test(value) ||
    value === "dist/server/wrangler.public.json" ||
    /^(?:credentials?|secrets?)(?:\.[^.]+)?$/i.test(base) ||
    /\.(?:pem|key|p12|pfx)$/i.test(base)
  );
}

function scanTarget(value) {
  const absolutePath = path.join(root, value);
  let stats;
  try {
    stats = lstatSync(absolutePath);
  } catch {
    return;
  }
  if (stats.isSymbolicLink()) {
    violations.push(`${value}: symbolic links cannot be safely content-scanned.`);
    return;
  }
  if (!stats.isFile()) return;
  if (stats.size > 8 * 1024 * 1024) {
    violations.push(`${value}: tracked or changed file exceeds the 8 MiB content-scan limit.`);
    return;
  }
  const content = readFileSync(absolutePath, "utf8");
  for (const finding of scanSensitiveContent(value, content)) {
    violations.push(`${value}: ${finding}.`);
  }
}

for (const value of trackedPaths) {
  if (isSensitivePath(value) && !deleted.has(value)) {
    violations.push(`${value}: sensitive or private material is tracked by Git.`);
  }
}

for (const value of paths) {
  if (isSensitivePath(value) && !deleted.has(value)) {
    violations.push(`${value}: sensitive or machine-local path must not be changed or staged.`);
  }
  if (/^drizzle\/\d+_[^/]+\.sql$/.test(value) && existsInHead(value)) {
    violations.push(`${value}: applied migrations are immutable; add the next migration instead.`);
  }
}

for (const value of new Set([...trackedPaths, ...paths])) scanTarget(value);

const generatedContentChanged = paths.some((value) =>
  matchesAny(value, [
    /^content\/public\//,
    /^content\/schema\//,
    /^content\/reports\/migration-quality\.md$/,
  ]),
);
const contentInputChanged = paths.some((value) =>
  matchesAny(value, [
    /^content\/curation\//,
    /^content\/presentation\//,
    /^scripts\/build-content\.mjs$/,
    /^scripts\/content\//,
  ]),
);
const contentAttestationChanged = paths.includes(
  "content/public/anish-content.public.v1.attestation.json",
);
if (generatedContentChanged && !contentInputChanged) {
  warnings.push("Generated content changed without a curation, presentation, or importer change; do not hand-edit generated output.");
}
if (generatedContentChanged && !contentAttestationChanged) {
  violations.push("Generated public content changed without a matching checked-in content attestation update.");
}
if (generatedContentChanged && contentAttestationChanged) {
  const attestationPath = path.join(
    root,
    "content/public/anish-content.public.v1.attestation.json",
  );
  try {
    const attestationText = readFileSync(attestationPath, "utf8");
    const attestedArtifacts = new Map();
    for (const artifactPath of [
      "content/public/anish-content.public.v1.json",
      "content/schema/anish-content.schema.json",
      "types/content.ts",
    ]) {
      if (!paths.includes(artifactPath)) continue;
      attestedArtifacts.set(
        artifactPath,
        readFileSync(path.join(root, artifactPath), "utf8"),
      );
    }
    for (const violation of verifyAttestedArtifacts(
      attestationText,
      attestedArtifacts,
    )) {
      violations.push(violation);
    }
  } catch {
    violations.push("Generated content changed but its attestation or an attested artifact is unreadable.");
  }
}

const ownerRouteChanged = paths.some((value) =>
  /^app\/api\/studio\/.*\/route\.ts$/.test(value),
);
const authOrOAuthChanged = paths.some((value) =>
  matchesAny(value, [
    /^worker\/(?:access|index)\.ts$/,
    /^lib\/server\/(?:cloudflare-access|owner-auth|owner-policy|request-security)/,
    /^lib\/server\/(?:http|connectors)\/.*oauth/i,
    /^app\/api\/(?:studio\/connectors\/[^/]+\/oauth|connectors\/[^/]+\/oauth)\//,
  ]),
);
const securityTestChanged = paths.some(
  (value) =>
    !deleted.has(value) &&
    /^tests\/(?:backend|security|cloudflare|content-.*(?:connector|oauth|strava)|play-promotion)/.test(value),
);
const securityTestsDeleted = paths.filter(
  (value) =>
    deleted.has(value) &&
    /^tests\/(?:backend|security|cloudflare|content-.*(?:connector|oauth|strava)|play-promotion)/.test(value),
);
if (securityTestsDeleted.length > 0 && !securityTestChanged) {
  violations.push(
    `Security regression coverage was deleted without replacement: ${securityTestsDeleted.join(", ")}.`,
  );
}
if ((ownerRouteChanged || authOrOAuthChanged) && !securityTestChanged) {
  violations.push("Owner write/auth/OAuth code changed without a security or connector regression test in the same change.");
}

const checks = [];
function addCheck(command) {
  if (!checks.includes(command)) checks.push(command);
}

const contentChanged = paths.some((value) =>
  matchesAny(value, [
    /^content\/(?:curation|presentation|public|schema|reports)\//,
    /^scripts\/build-content\.mjs$/,
    /^scripts\/content\//,
    /^lib\/(?:content|content-selectors|server\/public-content)/,
    /^types\/content/,
  ]),
);
const uiChanged = paths.some((value) =>
  matchesAny(value, [
    /^app\/(?!api\/)/,
    /^components\//,
    /^lib\/(?:seo|site-constants)/,
    /\.module\.css$/,
  ]),
);
const connectorChanged = paths.some((value) =>
  matchesAny(value, [
    /^app\/api\/(?:studio\/)?connectors\//,
    /^app\/studio\/(?:ConnectorControls|connectors\/)/,
    /^components\/(?:PersonalStreams|SpotifyStream|play\/|spotify\/)/,
    /^lib\/server\/(?:connectors|http\/connector|http\/myanimelist|http\/spotify|strava-config|play-promotion)/,
    /^drizzle\//,
  ]),
);
const backendChanged = paths.some((value) =>
  matchesAny(value, [
    /^app\/api\//,
    /^db\/schema\.ts$/,
    /^drizzle\//,
    /^lib\/server\//,
  ]),
);
const migrationChanged = paths.some((value) => /^drizzle\//.test(value));
const securityOrReleaseChanged = paths.some((value) =>
  matchesAny(value, [
    /^worker\//,
    /^lib\/server\/(?:cloudflare-access|owner-auth|owner-policy|request-security|credential-crypto|editorial-policy|runtime-env|csp)/,
    /^scripts\/(?:check-codeql-sarif|check-dependency-audit|prepare-cloudflare-release|publication-bootstrap-snippet|public-content-attestation|release-command|release-preflight|run-browser-quality|run-lighthouse-quality|scan-release-bundle|write-release-plan|write-release-attestation)\.mjs$/,
    /^scripts\/deployable-artifact-manifest\.mjs$/,
    /^scripts\/lib\/release(?:-[a-z0-9]+)*-contract\.mjs$/,
    /^scripts\/lib\/deployable-artifact-contract\.mjs$/,
    /^releases\//,
    /^\.github\//,
  ]),
);
const dependencyChanged = paths.some((value) =>
  /^(?:package\.json|package-lock\.json|vite\.config\.|tsconfig\.|next\.config\.)/.test(value),
);
const skillChanged = paths.some(
  (value) => value === "AGENTS.md" || value.startsWith(".agents/skills/"),
);
const responsiveSpotifyChanged = paths.some((value) =>
  matchesAny(value, [
    /^components\/(?:SpotifyStream|spotify\/)/,
    /^components\/play\/.*Spotify/i,
    /^app\/play\//,
  ]),
);
const releaseChanged = paths.some((value) =>
  matchesAny(value, [
    /^releases\//,
    /^scripts\/(?:check-codeql-sarif|check-dependency-audit|prepare-cloudflare-release|publication-bootstrap-snippet|public-content-attestation|release-command|release-preflight|run-browser-quality|run-lighthouse-quality|scan-release-bundle|write-release-plan|write-release-attestation)\.mjs$/,
    /^scripts\/deployable-artifact-manifest\.mjs$/,
    /^scripts\/lib\/release(?:-[a-z0-9]+)*-contract\.mjs$/,
    /^scripts\/lib\/deployable-artifact-contract\.mjs$/,
    /^docs\/operations\/release\.md$/,
  ]),
);

const deletedReleaseGuard = paths.find(
  (value) =>
    deleted.has(value) &&
    matchesAny(value, [
      /^scripts\/(?:check-codeql-sarif|check-dependency-audit|prepare-cloudflare-release|publication-bootstrap-snippet|public-content-attestation|release-command|release-preflight|run-browser-quality|run-lighthouse-quality|scan-release-bundle|write-release-plan|write-release-attestation)\.mjs$/,
      /^scripts\/deployable-artifact-manifest\.mjs$/,
      /^scripts\/lib\/release(?:-[a-z0-9]+)*-contract\.mjs$/,
      /^scripts\/lib\/deployable-artifact-contract\.mjs$/,
    ]),
);
if (deletedReleaseGuard) {
  violations.push(`${deletedReleaseGuard}: release guardrails cannot be deleted without an explicitly reviewed replacement.`);
}

if (contentChanged) {
  addCheck("npm run verify:content");
  addCheck("npm run content:attest");
  addCheck("npm run test:content");
  addCheck("npm run typecheck");
}
if (uiChanged) {
  addCheck("npm run typecheck");
  addCheck("npm run lint");
  addCheck("npm run build");
  addCheck("npm run test:rendered");
}
if (connectorChanged) {
  addCheck("npm run typecheck");
  addCheck("npm run test:content");
  addCheck("npm run test:backend");
}
if (backendChanged) {
  addCheck("npm run typecheck");
  addCheck("npm run test:backend");
}
if (migrationChanged) {
  addCheck("npm run db:local:migrate:clean");
}
if (securityOrReleaseChanged) {
  addCheck("npm run typecheck");
  addCheck("npm run test:backend");
  addCheck("npm run build");
  addCheck("npm run bundle:scan");
  addCheck("npm run security:audit");
}
if (dependencyChanged) {
  checks.length = 0;
  addCheck("npm run lint");
  addCheck("npm test");
  addCheck("npm run security:audit");
}
if (skillChanged) {
  notes.push("Validate changed skills with skill-creator's quick_validate.py before handoff.");
  addCheck("npm run test:maintenance-skill");
}
if (responsiveSpotifyChanged) {
  addCheck("npm run validate:browser");
}
if (releaseChanged) {
  checks.length = 0;
  addCheck("npm run validate:release");
  notes.push("Release validation never deploys, migrates production, rotates credentials, or mutates Git.");
}

if (mode === "full") {
  checks.length = 0;
  addCheck("npm run validate");
  addCheck("npm run validate:browser");
}

console.log("Maintenance change plan");
console.log(`Repository: ${root}`);
console.log(`Paths: ${paths.length}`);
for (const value of paths) console.log(`  - ${value}`);

if (violations.length) {
  console.error("\nGuardrail violations:");
  for (const value of violations) console.error(`  - ${value}`);
}
if (warnings.length) {
  console.warn("\nWarnings:");
  for (const value of warnings) console.warn(`  - ${value}`);
}
if (notes.length) {
  console.log("\nNotes:");
  for (const value of notes) console.log(`  - ${value}`);
}

console.log("\nChecks:");
if (checks.length) {
  for (const command of checks) console.log(`  - ${command}`);
} else {
  console.log("  - No application checks selected for these paths.");
}

if (violations.length) process.exit(1);
if (mode === "plan") process.exit(0);

for (const command of checks) {
  console.log(`\n> ${command}`);
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
