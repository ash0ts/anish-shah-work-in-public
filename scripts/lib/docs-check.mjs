import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const REQUIRED_DOCUMENTS = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/testing.md",
  "docs/architecture/overview.md",
  "docs/architecture/content-and-state.md",
  "docs/architecture/my-room-2001.md",
  "docs/operations/staging-and-previews.md",
  "docs/operations/release.md",
  "docs/operations/rollback.md",
  "docs/operations/incidents.md",
  "docs/operations/observability.md",
  "docs/play-connections.md",
  "docs/copywriting.md",
];

export const PRODUCTION_SMOKE_CHECKS = [
  "public_routes",
  "studio_access",
  "non_owner_denial",
  "connector_galleries",
  "oauth_callbacks",
  "security_headers",
  "owner_health",
  "simulation_experience",
  "canonical_apex",
  "www_redirect",
  "workers_dev_disabled",
  "preview_urls_disabled",
  "request_id_header",
  "access_destinations",
  "play_watch",
  "play_read",
  "play_listen",
  "play_collect",
  "play_play",
  "play_move",
  "play_travel",
];

async function fileExists(candidate) {
  const metadata = await stat(candidate).catch(() => null);
  return Boolean(metadata?.isFile());
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
  return [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(
    (match) => match[1].trim(),
  );
}

function localLinkTarget(root, sourcePath, target) {
  if (
    !target ||
    target.startsWith("#") ||
    /^(?:https?:|mailto:|tel:)/i.test(target)
  ) {
    return null;
  }
  const withoutTitle = target.replace(/\s+["'][^"']*["']\s*$/, "");
  const withoutFragment = withoutTitle.split("#", 1)[0].split("?", 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    return { issue: `contains a malformed encoded link target: ${target}` };
  }
  if (decoded.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(decoded)) {
    return { issue: `contains an absolute filesystem link: ${target}` };
  }
  const resolved = path.resolve(root, path.dirname(sourcePath), decoded);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { issue: `contains a link outside the repository: ${target}` };
  }
  return { resolved, target };
}

function includesEvery(source, values) {
  return values.every((value) => source.includes(value));
}

function semanticIssues(documents) {
  const issues = [];
  const requireTerms = (file, terms, description) => {
    const source = documents.get(file) ?? "";
    const normalized = source.toLowerCase();
    const missing = terms.filter(
      (term) => !normalized.includes(term.toLowerCase()),
    );
    if (missing.length > 0) {
      issues.push(`${file} is missing ${description}: ${missing.join(", ")}.`);
    }
  };

  requireTerms(
    "README.md",
    [
      "docs/testing.md",
      "docs/copywriting.md",
      "docs/architecture/my-room-2001.md",
    ],
    "links to the authoritative testing, copywriting, and My Room documents",
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

  for (const file of ["README.md", "docs/testing.md", "docs/play-connections.md"]) {
    const source = documents.get(file) ?? "";
    const setupIndex = source.indexOf("npm run setup:local");
    const ownerIndex = source.indexOf("OWNER_EMAILS", setupIndex + 1);
    const doctorIndex = source.indexOf("npm run doctor", setupIndex + 1);
    if (
      setupIndex < 0 ||
      ownerIndex < setupIndex ||
      doctorIndex < ownerIndex
    ) {
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
    "docs/operations/staging-and-previews.md",
    ["Local", "PR preview", "Live staging", "Production", "noindex", "Access", "synthetic"],
    "the four-tier environment, indexing, access, and fixture contract",
  );

  requireTerms(
    "docs/operations/release.md",
    [
      ...PRODUCTION_SMOKE_CHECKS,
      "RELEASE_BROWSER_URL",
      "COPY_VERSION",
    ],
    "the exact release evidence and production smoke contract",
  );
  for (const [file, source] of documents) {
    if (file === "docs/operations/release.md") continue;
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
    !/(?:six|6)[ -]hour/i.test(connectors)
  ) {
    issues.push(
      "docs/play-connections.md must document the Discogs four-hour refresh and six-hour public cutoff.",
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

  const documentationPaths = new Set([
    ...REQUIRED_DOCUMENTS,
    ...(await listMarkdownFiles(root, "docs")),
    "content/README.md",
    "content/copy/README.md",
  ]);
  for (const relativePath of [...documentationPaths].sort()) {
    if (documents.has(relativePath)) continue;
    const absolutePath = path.join(root, relativePath);
    if (!(await fileExists(absolutePath))) continue;
    documents.set(relativePath, await readFile(absolutePath, "utf8"));
  }

  for (const [relativePath, source] of documents) {
    if (/file:\/\//i.test(source) || /\/Users\/[A-Za-z0-9._-]+\//.test(source)) {
      issues.push(`${relativePath} contains a machine-local path.`);
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
      }
    }
  }

  issues.push(...semanticIssues(documents));
  return { checked: documents.size, issues, ok: issues.length === 0 };
}
