import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentPath = path.join(root, ".env.local");

if (process.env.CI || process.env.NODE_ENV === "production") {
  throw new Error("Local security setup is disabled in CI and production.");
}

const current = await readFile(environmentPath, "utf8").catch(() => {
  throw new Error("Create .env.local from .env.example before local setup.");
});
const line = `RATE_LIMIT_SALT=${randomBytes(32).toString("base64")}`;
const pattern = /^RATE_LIMIT_SALT=.*$/m;
const configured = /^RATE_LIMIT_SALT=.+$/m.test(current);

if (!configured) {
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current.replace(/\s*$/, "\n")}${line}\n`;
  const temporaryPath = `${environmentPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, next, { mode: 0o600 });
  await rename(temporaryPath, environmentPath);
}
await chmod(environmentPath, 0o600);
console.log(
  configured
    ? "Local rate-limit salt is already configured."
    : "Generated a local-only rate-limit salt without printing it.",
);
