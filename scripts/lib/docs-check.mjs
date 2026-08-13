import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { requiredReleaseSmokeTests } from "./release-smoke-contract.mjs";

export const AUTHORITY_MAP_DOCUMENTS = Object.freeze([
  "README.md",
  "CONTRIBUTING.md",
  "docs/architecture/overview.md",
  "docs/architecture/codebase-tour.md",
  "docs/architecture/content-and-state.md",
  "docs/architecture/my-room-2001.md",
  "docs/architecture/meet-me-simulation.md",
  "docs/travel-atlas.md",
  "docs/testing.md",
  "docs/play-connections.md",
  "docs/copywriting.md",
  "docs/audio-production.md",
  "SECURITY.md",
  "docs/security-notes.md",
  "docs/operations/bootstrap.md",
  "docs/operations/staging.md",
  "docs/operations/previews.md",
  "docs/operations/release.md",
  "docs/operations/rollback.md",
  "docs/operations/incidents.md",
  "docs/operations/observability.md",
  "content/README.md",
  "content/copy/README.md",
  ".github/runner/README.md",
  "releases/README.md",
]);

export const REQUIRED_DOCUMENTS = Object.freeze([
  ...new Set([
    "docs/README.md",
    "AGENTS.md",
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE/copy-change.md",
    ...AUTHORITY_MAP_DOCUMENTS,
  ]),
]);

export const PRODUCTION_SMOKE_CHECKS = Object.freeze(
  requiredReleaseSmokeTests({ travelAtlasMode: "atlas-v1" }),
);

const CODEBASE_TOUR_HEADINGS = Object.freeze([
  "system-context",
  "request-lifecycle",
  "content-and-state",
  "play-as-progressive-enhancement",
  "repository-map",
  "connector-boundary",
  "travel-boundary",
  "simulation-boundary",
  "environment-isolation",
  "release-path",
  "architectural-tradeoffs",
  "where-to-go-deeper",
]);

async function fileExists(candidate) {
  const metadata = await lstat(candidate).catch(() => null);
  return Boolean(metadata?.isFile() && !metadata.isSymbolicLink());
}

async function listMarkdownFiles(root, relativeDirectory) {
  const discovered = [];
  const queue = [relativeDirectory];
  while (queue.length > 0) {
    const current = queue.shift();
    const entries = await readdir(path.join(root, current), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      const relativePath = path.posix.join(current, entry.name);
      if (entry.isDirectory()) queue.push(relativePath);
      if (entry.isFile() && entry.name.endsWith(".md")) {
        discovered.push(relativePath);
      }
    }
  }
  return discovered.sort();
}

function markdownLinks(source) {
  return [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)].map(
    (match) => match[1].trim(),
  );
}

function linkDestination(rawTarget) {
  const angle = rawTarget.match(/^<([^>]+)>(?:\s+["'][^"']*["'])?$/u);
  if (angle) return angle[1];
  return rawTarget.replace(/\s+["'][^"']*["']\s*$/u, "");
}

function localLinkTarget(root, sourcePath, rawTarget) {
  const target = linkDestination(rawTarget);
  if (/^[a-zA-Z]:[\\/]/u.test(target)) {
    return { issue: `contains an absolute filesystem link: ${rawTarget}` };
  }
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target)) {
    return null;
  }

  const fragmentIndex = target.indexOf("#");
  const rawFragment = fragmentIndex >= 0 ? target.slice(fragmentIndex + 1) : "";
  const beforeFragment = fragmentIndex >= 0 ? target.slice(0, fragmentIndex) : target;
  const rawPath = beforeFragment.split("?", 1)[0];
  let decodedPath;
  let fragment;
  try {
    decodedPath = decodeURIComponent(rawPath);
    fragment = decodeURIComponent(rawFragment);
  } catch {
    return { issue: `contains a malformed encoded link target: ${rawTarget}` };
  }
  if (decodedPath.startsWith("/")) {
    return { issue: `contains an absolute filesystem link: ${rawTarget}` };
  }

  const resolved = path.resolve(
    root,
    path.dirname(sourcePath),
    decodedPath || path.basename(sourcePath),
  );
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { issue: `contains a link outside the repository: ${rawTarget}` };
  }
  return { fragment, resolved, target: rawTarget };
}

function markdownAnchorIds(source) {
  const anchors = new Set();
  const duplicates = new Map();
  let fenced = false;
  let fenceMarker = "";

  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (fence) {
      const marker = fence[1][0];
      if (!fenced) {
        fenced = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        fenced = false;
        fenceMarker = "";
      }
      continue;
    }
    if (fenced) continue;
    const heading = line.match(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/u);
    if (!heading) continue;
    const label = heading[1]
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/<[^>]*>/gu, "")
      .replace(/[`*_~]/gu, "")
      .trim()
      .toLowerCase();
    const base = label
      .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
      .replace(/\s+/gu, "-");
    const duplicate = duplicates.get(base) ?? 0;
    duplicates.set(base, duplicate + 1);
    anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`);
  }

  for (const match of source.matchAll(/\bid=["']([^"']+)["']/giu)) {
    anchors.add(match[1]);
  }
  return anchors;
}

function npmScriptReferences(source) {
  return [
    ...source.matchAll(
      /\bnpm[ \t]+run(?:[ \t]+--[A-Za-z0-9][A-Za-z0-9-]*(?:=[^\s`]+)?)*[ \t]+([A-Za-z0-9][A-Za-z0-9:_-]*)/gu,
    ),
  ].map((match) => match[1]);
}

function repositoryScriptPaths(source) {
  const paths = [];
  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    for (const match of line.matchAll(
      /(?:^|[\s"'`(=])((?:\.\/)?(?:scripts|tests|\.agents)\/[A-Za-z0-9_./-]+\.(?:mjs|js|cjs|sh|py))(?=$|[\s"'`),.;:!?\\])/gu,
    )) {
      paths.push(match[1].replace(/^\.\//u, ""));
    }
  }
  return paths;
}

function includesEvery(source, values) {
  return values.every((value) => source.includes(value));
}

function authorityMapIssues(root, documents) {
  const file = "docs/README.md";
  const source = documents.get(file);
  if (!source) return [];
  const issues = [];
  if (
    !/\|\s*Audience \/ task\s*\|\s*Type\s*\|\s*Canonical authority\s*\|\s*Update trigger\s*\|/iu.test(
      source,
    )
  ) {
    issues.push(
      `${file} must use the Audience / task / Type / Canonical authority / Update trigger table contract.`,
    );
  }
  if (!/^## Maintenance rule\s*$/mu.test(source)) {
    issues.push(`${file} must contain the Maintenance rule section.`);
  }

  const allowedTypes = new Set(["Concept", "How-to", "Reference", "Runbook"]);
  for (const line of source.split("\n")) {
    if (!line.startsWith("|") || /^\|[ -]+\|/u.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 4 || cells[1] === "Type") continue;
    if (!allowedTypes.has(cells[1])) {
      issues.push(`${file} contains an unsupported authority type: ${cells[1]}.`);
    }
  }

  const counts = new Map();
  for (const target of markdownLinks(source)) {
    const local = localLinkTarget(root, file, target);
    if (!local || local.issue) continue;
    const relative = path.relative(root, local.resolved).replaceAll(path.sep, "/");
    counts.set(relative, (counts.get(relative) ?? 0) + 1);
  }
  for (const authority of AUTHORITY_MAP_DOCUMENTS) {
    const count = counts.get(authority) ?? 0;
    if (count !== 1) {
      issues.push(
        `${file} must link the canonical authority ${authority} exactly once; found ${count}.`,
      );
    }
  }
  return issues;
}

function semanticIssues(documents) {
  const issues = [];
  const requireTerms = (file, terms, description) => {
    const source = documents.get(file) ?? "";
    const normalized = source.toLowerCase().replace(/\s+/gu, " ");
    const missing = terms.filter(
      (term) => !normalized.includes(term.toLowerCase().replace(/\s+/gu, " ")),
    );
    if (missing.length > 0) {
      issues.push(`${file} is missing ${description}: ${missing.join(", ")}.`);
    }
  };

  requireTerms(
    "README.md",
    ["docs/README.md", "docs/testing.md", "docs/operations/release.md"],
    "links to the documentation map, testing authority, and release authority",
  );
  if (!/reference(?:\s*\/\s*| and )recovery/i.test(documents.get("README.md") ?? "")) {
    issues.push(
      "README.md must describe the private Sites deployment as reference/recovery.",
    );
  }

  requireTerms(
    "docs/testing.md",
    ["npm run setup:local", "npm run doctor", "npm run validate", "npm run validate:browser"],
    "the authoritative local setup and validation commands",
  );

  for (const file of ["docs/testing.md"]) {
    const source = documents.get(file) ?? "";
    const setupIndex = source.indexOf("npm run setup:local");
    const ownerIndex = source.indexOf("OWNER_EMAILS", setupIndex + 1);
    const doctorIndex = source.indexOf("npm run doctor", setupIndex + 1);
    if (setupIndex < 0 || ownerIndex < setupIndex || doctorIndex < ownerIndex) {
      issues.push(
        `${file} must configure OWNER_EMAILS after setup:local and before doctor.`,
      );
    }
  }

  const room = documents.get("docs/architecture/my-room-2001.md") ?? "";
  requireTerms(
    "docs/architecture/my-room-2001.md",
    [
      "/play/watch",
      "/play/read",
      "/play/listen",
      "/play/collect",
      "/play/play",
      "/play/move",
      "/play/travel",
    ],
    "all seven semantic object routes",
  );
  if (!/connector/i.test(room) || !/(capability|progressive enhancement)/i.test(room)) {
    issues.push(
      "docs/architecture/my-room-2001.md must explain connector isolation and the room capability gate.",
    );
  }

  requireTerms(
    "docs/operations/bootstrap.md",
    ["one-time", "production", "staging", "explicit"],
    "the one-time hosted provisioning boundary",
  );
  requireTerms(
    "docs/operations/staging.md",
    ["Local", "PR preview", "Staging", "Production", "Access"],
    "the four-tier environment and access contract",
  );
  requireTerms(
    "docs/operations/previews.md",
    ["synthetic", "Access", "noindex"],
    "the synthetic, protected, noindex preview contract",
  );

  requireTerms(
    "docs/operations/release.md",
    [
      ...PRODUCTION_SMOKE_CHECKS,
      "RELEASE_BROWSER_URL",
      "COPY_VERSION",
      "npm run --silent release:smoke:list",
    ],
    "the exact release evidence and production smoke contract",
  );
  for (const [file, source] of documents) {
    if (new Set(["docs/operations/release.md", "releases/README.md"]).has(file)) {
      continue;
    }
    const leaked = PRODUCTION_SMOKE_CHECKS.filter((name) => source.includes(name));
    if (leaked.length > 0) {
      issues.push(
        `${file} duplicates production smoke identifiers owned by the release runbook: ${leaked.join(", ")}.`,
      );
    }
  }

  const connectors = documents.get("docs/play-connections.md") ?? "";
  if (
    !/Discogs/i.test(connectors) ||
    !/(?:four|4)[ -]hour/i.test(connectors) ||
    !/accepted snapshots have no age-based deletion or public cutoff/i.test(
      connectors,
    )
  ) {
    issues.push(
      "docs/play-connections.md must document the Discogs four-hour manual-refresh window and durable accepted snapshots.",
    );
  }
  requireTerms(
    "docs/play-connections.md",
    [
      "/api/connectors/myanimelist/oauth/callback",
      "/api/connectors/spotify/oauth/callback",
      "/api/connectors/discogs/oauth/callback",
    ],
    "the OAuth callback paths",
  );

  const copywriting = documents.get("docs/copywriting.md") ?? "";
  requireTerms(
    "docs/copywriting.md",
    ["content/copy", "$edit-anish-site-copy", "preview"],
    "the copy deck, copy skill, and preview workflow",
  );
  if (!/protect(?:ed|ion)/i.test(copywriting) || !/(implementation|code request)/i.test(copywriting)) {
    issues.push(
      "docs/copywriting.md must explain protected fields and the implementation-request workflow.",
    );
  }

  if (
    !includesEvery(documents.get("docs/testing.md") ?? "", [
      "Validate",
      "Gitleaks",
      "CodeQL",
      "Browser Quality",
    ])
  ) {
    issues.push(
      "docs/testing.md must name all four exact-SHA release evidence workflows.",
    );
  }

  const tour = documents.get("docs/architecture/codebase-tour.md") ?? "";
  const tourAnchors = markdownAnchorIds(tour);
  const missingTourHeadings = CODEBASE_TOUR_HEADINGS.filter(
    (heading) => !tourAnchors.has(heading),
  );
  if (missingTourHeadings.length > 0) {
    issues.push(
      `docs/architecture/codebase-tour.md is missing stable sections: ${missingTourHeadings.join(", ")}.`,
    );
  }
  requireTerms(
    "docs/architecture/codebase-tour.md",
    [
      "content/public/anish-content.public.v1.json",
      "app/api/studio/**",
      "explicit owner action",
      "not a connector",
      "scheduled",
      "retention",
      "Validate",
      "Gitleaks",
      "CodeQL",
      "Browser Quality",
    ],
    "the generated-content, owner-write, connector, retention, and release boundaries",
  );

  return issues;
}

export async function checkDocumentation({ root }) {
  if (!root) throw new Error("A repository root is required.");
  const issues = [];
  const documents = new Map();

  for (const relativePath of REQUIRED_DOCUMENTS) {
    const absolutePath = path.join(root, relativePath);
    if (!(await fileExists(absolutePath))) {
      issues.push(`Missing required documentation: ${relativePath}.`);
      continue;
    }
    documents.set(relativePath, await readFile(absolutePath, "utf8"));
  }

  const docsPaths = await listMarkdownFiles(root, "docs");
  for (const relativePath of docsPaths) {
    if (
      relativePath !== "docs/README.md" &&
      !AUTHORITY_MAP_DOCUMENTS.includes(relativePath)
    ) {
      issues.push(
        `${relativePath} is orphaned; every Markdown file under docs/ must appear in the authority map contract.`,
      );
    }
  }

  const documentationPaths = new Set([
    ...REQUIRED_DOCUMENTS,
    ...docsPaths,
    ...(await listMarkdownFiles(root, ".github/PULL_REQUEST_TEMPLATE")),
  ]);
  for (const relativePath of [...documentationPaths].sort()) {
    if (documents.has(relativePath)) continue;
    const absolutePath = path.join(root, relativePath);
    if (!(await fileExists(absolutePath))) continue;
    documents.set(relativePath, await readFile(absolutePath, "utf8"));
  }

  const packagePath = path.join(root, "package.json");
  let scripts = {};
  try {
    const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));
    if (
      !packageManifest?.scripts ||
      typeof packageManifest.scripts !== "object" ||
      Array.isArray(packageManifest.scripts)
    ) {
      throw new Error("scripts must be an object");
    }
    scripts = packageManifest.scripts;
  } catch (error) {
    issues.push(`package.json cannot validate documentation commands: ${error.message}.`);
  }

  const anchorCache = new Map();
  for (const [relativePath, source] of documents) {
    if (/file:\/\//i.test(source) || /\/Users\/[A-Za-z0-9._-]+\//u.test(source)) {
      issues.push(`${relativePath} contains a machine-local path.`);
    }

    for (const script of npmScriptReferences(source)) {
      if (typeof scripts[script] !== "string") {
        issues.push(`${relativePath} references an unknown npm script: ${script}.`);
      }
    }
    for (const scriptPath of repositoryScriptPaths(source)) {
      if (!(await fileExists(path.join(root, scriptPath)))) {
        issues.push(
          `${relativePath} references a missing repository script path: ${scriptPath}.`,
        );
      }
    }

    for (const target of markdownLinks(source)) {
      const local = localLinkTarget(root, relativePath, target);
      if (!local) continue;
      if (local.issue) {
        issues.push(`${relativePath} ${local.issue}`);
        continue;
      }
      if (!(await fileExists(local.resolved))) {
        issues.push(`${relativePath} has a broken local link: ${local.target}.`);
        continue;
      }
      if (local.fragment && path.extname(local.resolved).toLowerCase() === ".md") {
        if (!anchorCache.has(local.resolved)) {
          anchorCache.set(
            local.resolved,
            markdownAnchorIds(await readFile(local.resolved, "utf8")),
          );
        }
        if (!anchorCache.get(local.resolved).has(local.fragment)) {
          issues.push(
            `${relativePath} has a broken local anchor: ${local.target}.`,
          );
        }
      }
    }
  }

  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") continue;
    for (const scriptPath of repositoryScriptPaths(command)) {
      if (!(await fileExists(path.join(root, scriptPath)))) {
        issues.push(
          `package.json script ${name} references a missing repository script path: ${scriptPath}.`,
        );
      }
    }
  }

  issues.push(...authorityMapIssues(root, documents));
  issues.push(...semanticIssues(documents));
  return { checked: documents.size, issues, ok: issues.length === 0 };
}
