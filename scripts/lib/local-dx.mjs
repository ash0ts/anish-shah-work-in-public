import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const LOCAL_ENVIRONMENT_FILENAME = ".env.local";
export const CANONICAL_PRODUCTION_ORIGIN = "https://anish-shah-is.online";
export const LOCAL_SECRET_KEYS = [
  "CONNECTOR_ENCRYPTION_KEY",
  "RATE_LIMIT_SALT",
];

const HOSTED_ENVIRONMENT_KEYS = [
  "CI",
  "GITHUB_ACTIONS",
  "CF_PAGES",
  "WORKERS_CI",
  "VERCEL",
  "NETLIFY",
  "DEPLOYMENT_TIER",
  "CLOUDFLARE_ACCOUNT_ID",
];

function enabled(value) {
  if (value === undefined || value === null) return false;
  return !["", "0", "false", "no", "off"].includes(
    String(value).trim().toLowerCase(),
  );
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseEnvironmentFile(source) {
  const values = new Map();
  const lineIndexes = new Map();
  const lines = source.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (values.has(key)) {
      throw new Error(`Duplicate ${key} entry in ${LOCAL_ENVIRONMENT_FILENAME}.`);
    }
    values.set(key, unquote(match[2]));
    lineIndexes.set(key, index);
  }

  return { lineIndexes, lines, values };
}

export function isLoopbackOrigin(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function assertLocalSetupEnvironment(environment, fileValues = new Map()) {
  const hostedMarker = HOSTED_ENVIRONMENT_KEYS.find((key) =>
    enabled(environment[key]),
  );
  if (hostedMarker) {
    throw new Error(
      `Local setup is disabled when hosted or CI configuration is present (${hostedMarker}).`,
    );
  }
  if (environment.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new Error("Local setup is disabled when NODE_ENV is production.");
  }
  if (
    environment.AUTH_MODE?.trim() === "cloudflare_access" ||
    enabled(environment.PUBLIC_CONTENT_MODE)
  ) {
    throw new Error("Local setup is disabled for a hosted runtime configuration.");
  }

  for (const key of ["DEPLOYMENT_TIER", "AUTH_MODE", "PUBLIC_CONTENT_MODE"]) {
    if (fileValues.get(key)?.trim()) {
      throw new Error(
        `${LOCAL_ENVIRONMENT_FILENAME} contains hosted-only configuration (${key}).`,
      );
    }
  }

  const processSiteUrl = environment.SITE_URL?.trim();
  if (processSiteUrl && !isLoopbackOrigin(processSiteUrl)) {
    throw new Error("SITE_URL must be an exact loopback HTTP origin for local setup.");
  }
  const fileSiteUrl = fileValues.get("SITE_URL")?.trim();
  if (fileSiteUrl && !isLoopbackOrigin(fileSiteUrl)) {
    throw new Error(
      `${LOCAL_ENVIRONMENT_FILENAME} SITE_URL must be an exact loopback HTTP origin.`,
    );
  }
  const processProductionSiteUrl = environment.PRODUCTION_SITE_URL?.trim();
  if (
    processProductionSiteUrl &&
    processProductionSiteUrl !== CANONICAL_PRODUCTION_ORIGIN
  ) {
    throw new Error(
      "PRODUCTION_SITE_URL must match the canonical production origin for local setup.",
    );
  }
  const fileProductionSiteUrl = fileValues.get("PRODUCTION_SITE_URL")?.trim();
  if (
    fileProductionSiteUrl &&
    fileProductionSiteUrl !== CANONICAL_PRODUCTION_ORIGIN
  ) {
    throw new Error(
      `${LOCAL_ENVIRONMENT_FILENAME} PRODUCTION_SITE_URL must match the canonical production origin.`,
    );
  }
}

function secureRandomValue(random = randomBytes) {
  return random(32).toString("base64");
}

function replaceOrAppend(lines, lineIndexes, key, value) {
  const line = `${key}=${value}`;
  if (lineIndexes.has(key)) {
    lines[lineIndexes.get(key)] = line;
    return;
  }
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  lines.push(line, "");
}

async function assertSafeEnvironmentFile(filePath) {
  const metadata = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) return false;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(
      `${LOCAL_ENVIRONMENT_FILENAME} must be a regular file with exactly one link.`,
    );
  }
  return true;
}

export async function setupLocalEnvironment({
  root,
  environment = process.env,
  random = randomBytes,
} = {}) {
  if (!root) throw new Error("A repository root is required.");
  const environmentPath = path.join(root, LOCAL_ENVIRONMENT_FILENAME);
  const examplePath = path.join(root, ".env.example");
  const exists = await assertSafeEnvironmentFile(environmentPath);
  const source = exists
    ? await readFile(environmentPath, "utf8")
    : await readFile(examplePath, "utf8").catch(() => {
        throw new Error(".env.example is required before local setup.");
      });
  const parsed = parseEnvironmentFile(source);
  assertLocalSetupEnvironment(environment, parsed.values);

  const generated = [];
  for (const key of LOCAL_SECRET_KEYS) {
    if (parsed.values.get(key)?.trim()) continue;
    replaceOrAppend(
      parsed.lines,
      parsed.lineIndexes,
      key,
      secureRandomValue(random),
    );
    generated.push(key);
  }

  if (!exists || generated.length > 0) {
    await mkdir(path.dirname(environmentPath), { recursive: true });
    const temporaryPath = `${environmentPath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      await writeFile(temporaryPath, parsed.lines.join("\n"), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, environmentPath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
  }
  await chmod(environmentPath, 0o600);

  return {
    created: !exists,
    generated,
    permissionMode: 0o600,
  };
}

export function formatSetupResult(result) {
  const lines = [];
  if (result.created) {
    lines.push("Created a permission-restricted local environment file.");
  }
  lines.push(
    result.generated.length > 0
      ? `Generated ${result.generated.length} missing local-only security value(s) without printing them.`
      : "Local-only security values were already configured; no values were changed.",
  );
  lines.push("Local environment permissions are owner-only (0600).");
  return lines.join("\n");
}

function semverMatches(actual, expected) {
  const normalized = String(actual).trim().replace(/^v/, "");
  if (/^\d+\.x$/.test(expected)) {
    return normalized.startsWith(`${expected.slice(0, -2)}.`);
  }
  if (/^\d+\.\d+\.x$/.test(expected)) {
    return normalized.startsWith(`${expected.slice(0, -2)}.`);
  }
  return normalized === expected;
}

function check(id, status, message) {
  return { id, status, message };
}

async function pathExists(candidate) {
  return Boolean(await stat(candidate).catch(() => null));
}

async function manualBrowserAvailable(_root, homeDirectory = os.homedir()) {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Safari.app",
          "/Applications/Google Chrome.app",
          path.join(homeDirectory, "Applications/Safari.app"),
          path.join(homeDirectory, "Applications/Google Chrome.app"),
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
        ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return true;
  }
  return false;
}

async function playwrightChromiumAvailable() {
  try {
    const { chromium } = await import("@playwright/test");
    const executablePath = chromium.executablePath();
    const metadata = await stat(executablePath);
    return metadata.isFile();
  } catch {
    return false;
  }
}

export async function portAvailable(port, host = "127.0.0.1") {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function migrationInventory(root) {
  const migrationDirectory = path.join(root, "drizzle");
  const files = (await readdir(migrationDirectory).catch(() => []))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (files.length === 0) {
    return { ok: false, count: 0, message: "No ordered D1 migrations were found." };
  }
  for (const [index, name] of files.entries()) {
    if (!name.startsWith(String(index).padStart(4, "0"))) {
      return {
        ok: false,
        count: files.length,
        message: "D1 migration numbering is not contiguous.",
      };
    }
  }
  const journalPath = path.join(migrationDirectory, "meta/_journal.json");
  const journal = await readFile(journalPath, "utf8")
    .then(JSON.parse)
    .catch(() => null);
  const journalTags = journal?.entries?.map((entry) => entry.tag);
  const fileTags = files.map((name) => name.replace(/\.sql$/, ""));
  if (
    !Array.isArray(journalTags) ||
    journalTags.length !== fileTags.length ||
    journalTags.some((tag, index) => tag !== fileTags[index])
  ) {
    return {
      ok: false,
      count: files.length,
      message: "D1 migration files and the Drizzle journal do not match.",
    };
  }
  return {
    ok: true,
    count: files.length,
    message: `${files.length} ordered D1 migrations match the journal.`,
  };
}

async function localD1Exists(root) {
  const stateRoot = path.join(root, ".wrangler/state");
  const queue = [stateRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(candidate);
      if (entry.isFile() && /\.(sqlite|sqlite3|db)$/.test(entry.name)) return true;
    }
  }
  return false;
}

function validateLocalEnvironment(values) {
  const required = [
    "OWNER_EMAILS",
    "LOCAL_OWNER_EMAIL",
    "CONNECTOR_ENCRYPTION_KEY",
    "RATE_LIMIT_SALT",
    "SITE_URL",
    "PRODUCTION_SITE_URL",
  ];
  const missing = required.filter((key) => !values.get(key)?.trim());
  if (missing.length > 0) {
    return `Missing ${missing.length} required local environment entr${missing.length === 1 ? "y" : "ies"}.`;
  }
  for (const key of ["DEPLOYMENT_TIER", "AUTH_MODE", "PUBLIC_CONTENT_MODE"]) {
    if (values.get(key)?.trim()) {
      return `${key} is hosted-only and must not be configured locally.`;
    }
  }
  const owner = values.get("LOCAL_OWNER_EMAIL").trim().toLowerCase();
  const allowlist = values
    .get("OWNER_EMAILS")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.includes(owner)) {
    return "The local owner is not included in the owner allowlist.";
  }
  if (/@example\.(?:com|org|net)$/.test(owner)) {
    return "The local owner still uses a documented placeholder address.";
  }
  if (!isLoopbackOrigin(values.get("SITE_URL"))) {
    return "SITE_URL is not an exact loopback HTTP origin.";
  }
  if (values.get("PRODUCTION_SITE_URL") !== CANONICAL_PRODUCTION_ORIGIN) {
    return "PRODUCTION_SITE_URL does not match the canonical production origin.";
  }
  for (const key of LOCAL_SECRET_KEYS) {
    const value = values.get(key).trim();
    let bytes;
    try {
      bytes = Buffer.from(value, "base64");
    } catch {
      return `${key} is not a valid local secret.`;
    }
    if (bytes.length !== 32 || bytes.toString("base64") !== value) {
      return `${key} is not a valid 32-byte base64 local secret.`;
    }
  }
  return null;
}

export async function createDoctorReport({
  root,
  environment = process.env,
  command = spawnSync,
  homeDirectory = os.homedir(),
  checkBrowser = playwrightChromiumAvailable,
  checkManualBrowser = manualBrowserAvailable,
  checkPort = portAvailable,
  nodeVersion = process.version,
} = {}) {
  if (!root) throw new Error("A repository root is required.");
  const checks = [];
  const packageJson = await readFile(path.join(root, "package.json"), "utf8")
    .then(JSON.parse)
    .catch(() => null);
  if (!packageJson) {
    return {
      checks: [check("repository", "fail", "package.json is missing or invalid.")],
      ok: false,
    };
  }

  let processEnvironmentProblem = null;
  try {
    assertLocalSetupEnvironment(environment, new Map());
  } catch (error) {
    processEnvironmentProblem =
      error instanceof Error
        ? error.message
        : "The inherited process environment is unsafe for local development.";
  }
  checks.push(
    check(
      "process-environment",
      processEnvironmentProblem ? "fail" : "pass",
      processEnvironmentProblem ??
        "Inherited process configuration is safe for loopback development.",
    ),
  );

  const expectedNode = packageJson.engines?.node;
  checks.push(
    check(
      "node",
      expectedNode && semverMatches(nodeVersion, expectedNode) ? "pass" : "fail",
      expectedNode && semverMatches(nodeVersion, expectedNode)
        ? "Node matches the repository pin."
        : "Node does not match the repository pin.",
    ),
  );
  const npmResult = command("npm", ["--version"], {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
  const expectedNpm = packageJson.packageManager?.match(/^npm@(.+)$/)?.[1];
  checks.push(
    check(
      "npm",
      npmResult.status === 0 && npmResult.stdout?.trim() === expectedNpm
        ? "pass"
        : "fail",
      npmResult.status === 0 && npmResult.stdout?.trim() === expectedNpm
        ? "npm matches the repository pin."
        : "npm does not match the repository pin.",
    ),
  );
  const dependenciesPresent = await pathExists(
    path.join(root, "node_modules/.package-lock.json"),
  );
  checks.push(
    check(
      "dependencies",
      dependenciesPresent ? "pass" : "fail",
      dependenciesPresent
        ? "Installed dependencies are present."
        : "Installed dependencies are missing; run npm ci.",
    ),
  );

  const environmentPath = path.join(root, LOCAL_ENVIRONMENT_FILENAME);
  const environmentMetadata = await lstat(environmentPath).catch(() => null);
  if (!environmentMetadata || !environmentMetadata.isFile() || environmentMetadata.isSymbolicLink()) {
    checks.push(
      check(
        "local-environment",
        "fail",
        ".env.local is missing or is not a regular file; run npm run setup:local.",
      ),
    );
  } else {
    const parsed = await readFile(environmentPath, "utf8")
      .then(parseEnvironmentFile)
      .catch(() => null);
    const environmentProblem = parsed
      ? validateLocalEnvironment(parsed.values)
      : ".env.local could not be parsed safely.";
    checks.push(
      check(
        "local-environment",
        environmentProblem ? "fail" : "pass",
        environmentProblem ?? "Required local environment entries are configured.",
      ),
    );
    const unsafeBits = environmentMetadata.mode & 0o077;
    checks.push(
      check(
        "environment-permissions",
        unsafeBits === 0 ? "pass" : "fail",
        unsafeBits === 0
          ? ".env.local permissions are owner-only."
          : ".env.local is readable or writable by group/others; run npm run setup:local.",
      ),
    );
    if (parsed?.values.get("PLAY_EXPERIENCE_MODE") === "classic") {
      checks.push(
        check(
          "local-play-override",
          "fail",
          ".env.local overrides the default My Room experience; remove that entry and use the explicit Classic command when needed.",
        ),
      );
    }
  }

  const migration = await migrationInventory(root);
  checks.push(
    check("migrations", migration.ok ? "pass" : "fail", migration.message),
  );
  const d1Present = await localD1Exists(root);
  checks.push(
    check(
      "local-d1",
      d1Present ? "pass" : "warn",
      d1Present
        ? "Local D1 state is present."
        : "Local D1 state is not initialized; run npm run db:local:migrate.",
    ),
  );

  const browserPresent = await checkBrowser(root, homeDirectory);
  checks.push(
    check(
      "playwright-chromium",
      browserPresent ? "pass" : "warn",
      browserPresent
        ? "The pinned Playwright Chromium executable is installed."
        : "Playwright Chromium is missing; run npx --no-install playwright install chromium before browser validation.",
    ),
  );
  const manualBrowserPresent = await checkManualBrowser(root, homeDirectory);
  checks.push(
    check(
      "manual-browser",
      manualBrowserPresent ? "pass" : "warn",
      manualBrowserPresent
        ? "Safari or Chromium is available for manual review."
        : "No Safari or Chromium installation was detected for manual review.",
    ),
  );
  for (const port of [3000, 3001]) {
    const available = await checkPort(port);
    checks.push(
      check(
        `port-${port}`,
        available ? "pass" : "warn",
        available
          ? `Local development port ${port} is available.`
          : `Local development port ${port} is already in use.`,
      ),
    );
  }

  const defaultDev = packageJson.scripts?.dev ?? "";
  const classicDev = packageJson.scripts?.["dev:classic"] ?? "";
  checks.push(
    check(
      "play-mode",
      defaultDev.includes("PLAY_EXPERIENCE_MODE=my-room-2001") &&
        classicDev.includes("PLAY_EXPERIENCE_MODE=classic")
        ? "pass"
        : "fail",
      defaultDev.includes("PLAY_EXPERIENCE_MODE=my-room-2001") &&
        classicDev.includes("PLAY_EXPERIENCE_MODE=classic")
        ? "My Room 2001 is the default; Classic is explicit."
        : "Local Play commands do not enforce the expected My Room/Classic modes.",
    ),
  );

  return {
    checks,
    ok: !checks.some((entry) => entry.status === "fail"),
  };
}

export function formatDoctorReport(report) {
  const lines = report.checks.map(
    (entry) => `${entry.status.toUpperCase().padEnd(4)} ${entry.id}: ${entry.message}`,
  );
  const passCount = report.checks.filter((entry) => entry.status === "pass").length;
  const warningCount = report.checks.filter((entry) => entry.status === "warn").length;
  const failureCount = report.checks.filter((entry) => entry.status === "fail").length;
  lines.push(
    `${report.ok ? "READY" : "NOT READY"}: ${passCount} passed, ${warningCount} warning(s), ${failureCount} failure(s).`,
  );
  return lines.join("\n");
}
