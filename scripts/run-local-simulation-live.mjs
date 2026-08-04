import { spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "env-file": { type: "string" },
    model: { type: "string", default: "claude-sonnet-5" },
  },
  strict: true,
});

if (process.env.CI || process.env.NODE_ENV === "production") {
  throw new Error("Local live-model mode is disabled in CI and production.");
}

const suppliedPath = values["env-file"]?.trim();
if (!suppliedPath) {
  throw new Error(
    "Pass a permission-restricted file with --env-file. The file must define ANTHROPIC_API_KEY.",
  );
}

const model = values.model?.trim() ?? "";
if (!/^claude-[a-z0-9.-]{1,80}$/i.test(model)) {
  throw new Error("The requested Anthropic model ID is invalid.");
}

const candidatePath = path.resolve(suppliedPath);
const candidateStat = await lstat(candidatePath).catch(() => null);
if (!candidateStat?.isFile() || candidateStat.isSymbolicLink()) {
  throw new Error("The supplied environment path must be a regular file.");
}
if ((candidateStat.mode & 0o077) !== 0) {
  throw new Error(
    "The supplied environment file must use owner-only permissions (0600 or stricter).",
  );
}
if (typeof process.getuid === "function" && candidateStat.uid !== process.getuid()) {
  throw new Error("The supplied environment file must be owned by the current user.");
}

const environmentPath = await realpath(candidatePath);
let source = await readFile(environmentPath, "utf8");
const assignedNames = new Set();
let apiKey = null;

function parseValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("ANTHROPIC_API_KEY has invalid double-quoted syntax.");
    }
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

for (const line of source.split(/\r?\n/)) {
  if (!line.trim() || /^\s*#/.test(line)) continue;
  const assignment = line.match(
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/,
  );
  if (!assignment) continue;
  const [, name, rawValue] = assignment;
  assignedNames.add(name);
  if (name === "ANTHROPIC_API_KEY") {
    if (apiKey !== null) {
      throw new Error("ANTHROPIC_API_KEY must be assigned exactly once.");
    }
    apiKey = parseValue(rawValue);
  }
}
source = "";

if (
  typeof apiKey !== "string" ||
  apiKey.length < 20 ||
  apiKey.length > 1_024 ||
  /[\s\u0000-\u001f\u007f]/.test(apiKey)
) {
  throw new Error("ANTHROPIC_API_KEY is missing or malformed.");
}

const childEnvironment = { ...process.env };
// Do not pass any other value from the shared file into the application.
for (const name of assignedNames) delete childEnvironment[name];
for (const name of [
  "SIMULATION_GATEWAY_ACCOUNT_ID",
  "SIMULATION_GATEWAY_ID",
  "SIMULATION_GATEWAY_TOKEN",
  "SIMULATION_GATEWAY_BYOK_ALIAS",
  "DEPLOYMENT_TIER",
]) {
  delete childEnvironment[name];
}

Object.assign(childEnvironment, {
  NODE_ENV: "development",
  SITE_URL: "http://localhost:3000",
  SIMULATION_EXPERIENCE_MODE: "campaign-v1",
  SIMULATION_AI_MODE: "live",
  SIMULATION_AI_TRANSPORT: "direct-local",
  SIMULATION_PROVIDER: "anthropic",
  SIMULATION_MODEL: model,
  SIMULATION_DAILY_MODEL_LIMIT:
    process.env.SIMULATION_DAILY_MODEL_LIMIT?.trim() || "25",
  SIMULATION_LOCAL_ANTHROPIC_API_KEY: apiKey,
});
apiKey = null;

console.log("Starting Meet Me with live Claude at http://localhost:3000/simulation");
console.log(
  "The provider key is bound only to the loopback development Worker: it will not enter .env.local, Git, D1, or the browser.",
);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCommand, ["run", "dev:studio"], {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: "inherit",
  shell: false,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

let exitCode = 1;
try {
  exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
} finally {
  delete childEnvironment.SIMULATION_LOCAL_ANTHROPIC_API_KEY;
}
process.exitCode = exitCode;
