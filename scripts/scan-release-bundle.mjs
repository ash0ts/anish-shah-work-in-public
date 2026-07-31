import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = process.cwd();
const targets = [resolve(root, "dist/client"), resolve(root, "dist/server")];
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".txt",
  ".xml",
]);
const forbidden = [
  { label: "local file URI", pattern: /file:\/\/\//i },
  { label: "macOS user path", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: "Windows user path", pattern: /[A-Z]:\\Users\\[^\\]+\\/i },
  { label: "private Slack archive URL", pattern: /https?:\/\/[^\s"']+\.slack\.com\/archives\//i },
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    label: "literal connector secret assignment",
    pattern: /(?:CONNECTOR_ENCRYPTION_KEY|MAL_CLIENT_SECRET|STEAM_API_KEY|HARDCOVER_API_KEY)\s*=\s*[^\s"']+/i,
  },
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

const violations = [];
for (const target of targets) {
  for (const path of await files(target)) {
    const name = relative(root, path);
    if (/(?:^|\/)\.env(?:\.|$)/i.test(name)) {
      violations.push(`${name}: environment file must not be deployed`);
      continue;
    }
    if (!textExtensions.has(extname(path))) continue;
    const info = await stat(path);
    if (info.size > 8 * 1024 * 1024) continue;
    const body = await readFile(path, "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(body)) violations.push(`${name}: ${rule.label}`);
    }
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Release bundle privacy scan passed.");
}
