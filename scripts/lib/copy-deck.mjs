import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import {
  COPY_PAGE_DEFINITIONS,
  WORK_GROUP_COPY_DEFINITIONS,
} from "../../lib/copy-contract.ts";

export const COPY_PAGE_FILES = {
  site: "content/copy/pages/site.md",
  home: "content/copy/pages/home.md",
  work: "content/copy/pages/work.md",
  play: "content/copy/pages/play.md",
  sources: "content/copy/pages/sources.md",
};

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const RAW_MARKUP = /<\/?[A-Za-z!][^>]*>|<>/u;
const EMBEDDED_LINK = /(?:https?:\/\/|www\.|mailto:|javascript:|\[[^\]]+\]\([^)]*\)|!\[[^\]]*\]\([^)]*\))/iu;
const PRIVATE_PATH = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\|file:\/\/|\.env(?:\.|\b)|content\/private|\.wrangler\/)/iu;
const INTERNAL_LOCATION = /(?:localhost|127\.0\.0\.1|notion\.so|slack\.com|hex\.tech|chatgpt\.site)/iu;
const EXECUTABLE_SYNTAX = /(?:```|~~~|<script|<iframe|\bon\w+\s*=|\$\{|\{\{|\{%|\b(?:import|export)\s+(?:from|default|const|function|class)\b)/iu;
const METRIC_SHAPED_COPY = [
  /(?:[$€£]\s*\d|\b(?:USD|EUR|GBP)\s+\d)/iu,
  /\b\d+(?:\.\d+)?\s*%/u,
  /\b\d+(?:\.\d+)?\s*[KMB]\+?/u,
  /\b\d[\d,.]*\+?\s+(?:course\s+)?(?:enrollments?|registrants?|attendees?|users?|organizations?|revenue|ARR|pipeline|tool\s+calls?|signups?|leads?|customers?)\b/iu,
];
const METRIC_SUBJECT = /\b(?:course\s+enrollments?|enrollments?|registrants?|attendees?|learners?|completions?|users?|organizations?|accounts?|customers?|signups?|leads?|tool\s+calls?|weekly\s+active|returning|re-?engaged|conversion(?:s|\s+rate)?|pipeline|ARR|revenue|bookings?|public\s+forms?|source\s+records?|evidence\s+records?)\b/iu;
const QUANTIFIER_WORDING = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?|all|half|thirds?|quarters?|majority|most|nearly\s+all|almost\s+all|more\s+than|less\s+than|fewer\s+than|over|under|approximately|about)\b/iu;
const CURRENCY_WORDING = /(?:[$€£]|\b(?:USD|EUR|GBP|dollars?|euros?|pounds?\s+sterling)\b)/iu;
const PERCENT_WORDING = /\b(?:percent|percentage|basis\s+points?)\b/iu;
const QUANTIFIED_METRIC_WORDING = new RegExp(
  `${QUANTIFIER_WORDING.source}(?:\\s+[\\p{L}-]+){0,3}\\s+${METRIC_SUBJECT.source}`,
  "iu",
);
const PERCENT_METRIC_WORDING = new RegExp(
  `(?:${PERCENT_WORDING.source}(?:\\s+[\\p{L}-]+){0,3}\\s+${METRIC_SUBJECT.source}|${METRIC_SUBJECT.source}(?:\\s+[\\p{L}-]+){0,3}\\s+${PERCENT_WORDING.source})`,
  "iu",
);

function failure(file, message) {
  throw new Error(`${file}: ${message}`);
}

function normalizedText(value) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function definitionsByKey(definitions) {
  return new Map(definitions.map((definition) => [definition.key, definition]));
}

export function parseCopyDocument({
  file,
  source,
  expectedMarker,
  definitions,
}) {
  const text = normalizedText(source);
  if (!text.endsWith("\n")) failure(file, "the file must end with a newline");
  const lines = text.split("\n");
  if (lines[0] !== expectedMarker) {
    failure(file, `the first line must be exactly ${expectedMarker}`);
  }
  if (lines[1] !== "") failure(file, "add one blank line after the marker");

  const allowed = definitionsByKey(definitions);
  const values = {};
  let key = null;
  let buffer = [];

  const commit = () => {
    if (key === null) return;
    const value = buffer.join("\n").trim();
    const definition = allowed.get(key);
    if (!definition) failure(file, `unknown field heading: ${key}`);
    if (Object.hasOwn(values, key)) failure(file, `duplicate field heading: ${key}`);
    validateCopyValue({ file, definition, value });
    values[key] = value;
  };

  for (const [index, line] of lines.entries()) {
    if (index < 2) continue;
    const heading = line.match(/^## ([a-z0-9]+(?:-[a-z0-9]+)*)$/u);
    if (heading) {
      commit();
      key = heading[1];
      buffer = [];
      continue;
    }
    if (line.startsWith("##")) {
      failure(file, `invalid field heading on line ${index + 1}`);
    }
    if (key === null) {
      if (line.trim()) failure(file, `text outside a field on line ${index + 1}`);
      continue;
    }
    buffer.push(line);
  }
  commit();

  for (const definition of definitions) {
    if (definition.required && !Object.hasOwn(values, definition.key)) {
      failure(file, `missing required field: ${definition.key}`);
    }
  }
  return values;
}

export function validateCopyValue({ file, definition, value }) {
  if (!value && definition.required) failure(file, `${definition.key} cannot be empty`);
  if (!value) return;
  if (value.length > definition.maxLength) {
    failure(
      file,
      `${definition.key} is ${value.length} characters; maximum is ${definition.maxLength}`,
    );
  }
  if (!definition.allowParagraphs && value.includes("\n")) {
    failure(file, `${definition.key} must be a single line`);
  }
  if (CONTROL_CHARACTERS.test(value)) failure(file, `${definition.key} contains a control character`);
  if (RAW_MARKUP.test(value) || value.includes("<") || value.includes(">")) {
    failure(file, `${definition.key} cannot contain HTML or JSX markup`);
  }
  if (EMBEDDED_LINK.test(value)) failure(file, `${definition.key} cannot contain a link or URL`);
  if (PRIVATE_PATH.test(value)) failure(file, `${definition.key} contains a private path or secret-file reference`);
  if (INTERNAL_LOCATION.test(value)) failure(file, `${definition.key} contains a forbidden internal or local domain`);
  if (EXECUTABLE_SYNTAX.test(value) || /[{}]/u.test(value)) {
    failure(file, `${definition.key} contains executable or template-like syntax`);
  }
  if (definition.surface === "site" && definition.key === "title-template") {
    const placeholders = value.match(/%s/gu) ?? [];
    if (placeholders.length !== 1 || value.replace("%s", "").includes("%")) {
      failure(file, `${definition.key} must contain exactly one %s placeholder`);
    }
  }
  if (
    METRIC_SHAPED_COPY.some((pattern) => pattern.test(value)) ||
    CURRENCY_WORDING.test(value) ||
    QUANTIFIED_METRIC_WORDING.test(value) ||
    PERCENT_METRIC_WORDING.test(value)
  ) {
    failure(
      file,
      `${definition.key} contains quantitative metric wording; propose metric changes for owner review instead`,
    );
  }
  if (definition.key === "seo-description" && value.length < 80) {
    failure(file, `${definition.key} must be at least 80 characters`);
  }
  if (definition.key === "seo-title" && value.length < 2) {
    failure(file, `${definition.key} is too short`);
  }
}

async function regularFile(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const stat = await lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    failure(relativePath, "copy sources must be regular files, not links");
  }
  return normalizedText(await readFile(absolutePath, "utf8"));
}

function safeWorkGroupFilename(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    throw new Error(`WorkGroup slug cannot be used as a copy filename: ${slug}`);
  }
  return `${slug}.md`;
}

export async function readCopyDeck(root) {
  const publicBundle = JSON.parse(
    await regularFile(root, "content/public/anish-content.public.v1.json"),
  );
  const pages = {};
  const sourceFiles = [];
  for (const [pageId, relativePath] of Object.entries(COPY_PAGE_FILES)) {
    const source = await regularFile(root, relativePath);
    pages[pageId] = parseCopyDocument({
      file: relativePath,
      source,
      expectedMarker: `<!-- copy-page: ${pageId} -->`,
      definitions: COPY_PAGE_DEFINITIONS[pageId],
    });
    sourceFiles.push({ path: relativePath, source });
  }

  const publicGroups = publicBundle.workGroups.filter(
    (group) => group.publicationState === "public",
  );
  const workDirectory = "content/copy/work-groups";
  const expectedFiles = new Map(
    publicGroups.map((group) => [safeWorkGroupFilename(group.slug), group]),
  );
  const actualFiles = (await readdir(path.join(root, workDirectory)))
    .filter((name) => !name.startsWith("."))
    .sort();
  const expectedNames = [...expectedFiles.keys()].sort();
  if (actualFiles.join("\n") !== expectedNames.join("\n")) {
    const missing = expectedNames.filter((name) => !actualFiles.includes(name));
    const unexpected = actualFiles.filter((name) => !expectedFiles.has(name));
    throw new Error(
      `${workDirectory}: files must match public WorkGroups exactly; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
    );
  }

  const workGroups = {};
  for (const filename of actualFiles) {
    const group = expectedFiles.get(filename);
    const relativePath = `${workDirectory}/${filename}`;
    const source = await regularFile(root, relativePath);
    const values = parseCopyDocument({
      file: relativePath,
      source,
      expectedMarker: `<!-- copy-record: ${group.id} -->`,
      definitions: WORK_GROUP_COPY_DEFINITIONS,
    });
    workGroups[group.id] = {
      displayTitle: values["display-title"],
      shortTitle: values["short-title"],
      summary: values.summary,
      roleSummary: values["role-summary"],
      ...(values["home-title"] ? { homeTitle: values["home-title"] } : {}),
      ...(values["home-role"] ? { homeRole: values["home-role"] } : {}),
    };
    sourceFiles.push({ path: relativePath, source });
  }

  return { pages, workGroups, sourceFiles, publicBundle };
}

export async function copyVersionForDeck(root, sourceFiles) {
  const implementationPaths = [
    "lib/copy-contract.ts",
    "scripts/lib/copy-deck.mjs",
    "scripts/generate-copy-deck.mjs",
  ];
  const files = [...sourceFiles];
  for (const relativePath of implementationPaths) {
    files.push({ path: relativePath, source: await regularFile(root, relativePath) });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const hash = createHash("sha256");
  hash.update("anish-copy-deck-v1\0");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(String(Buffer.byteLength(file.source)));
    hash.update("\0");
    hash.update(file.source);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

export async function buildCopyDeck(root) {
  const deck = await readCopyDeck(root);
  return {
    ...deck,
    copyVersion: await copyVersionForDeck(root, deck.sourceFiles),
  };
}

export async function copyRiskManifest(root) {
  const deck = await readCopyDeck(root);
  const fields = [];
  for (const [pageId, values] of Object.entries(deck.pages)) {
    const definitions = definitionsByKey(COPY_PAGE_DEFINITIONS[pageId]);
    for (const key of Object.keys(values)) {
      const route =
        pageId === "home"
          ? "/"
          : pageId !== "site"
            ? `/${pageId}`
            : key.startsWith("not-found-")
              ? "/404"
              : key.startsWith("header-") ||
                  key.startsWith("footer-") ||
                  key === "skip-link"
                ? "all-public-routes"
                : "/";
      fields.push({ key: `${pageId}.${key}`, risk: definitions.get(key).risk, route });
    }
  }
  for (const [groupId, values] of Object.entries(deck.workGroups)) {
    const group = deck.publicBundle.workGroups.find((candidate) => candidate.id === groupId);
    const definitions = definitionsByKey(WORK_GROUP_COPY_DEFINITIONS);
    for (const key of Object.keys(values)) {
      const sourceKey = key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
      fields.push({ key: `${groupId}.${sourceKey}`, risk: definitions.get(sourceKey).risk, route: `/work/${group.slug}` });
    }
  }
  return fields;
}

export function copyChangedPaths(...pathLists) {
  return [
    ...new Set(
      pathLists
        .flatMap((value) => String(value ?? "").split("\n"))
        .map((value) => value.trim())
        .filter(
          (value) =>
            value.startsWith("content/copy/") && value.endsWith(".md"),
        ),
    ),
  ].sort();
}
