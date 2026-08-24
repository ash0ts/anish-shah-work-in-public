import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_LANGUAGE_LITERAL_ALLOWLIST,
  auditPublicLanguageOwnership,
  isPublicLanguageSource,
} from "./lib/public-language-ownership.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sourceFiles(directory) {
  const absolute = path.join(root, directory);
  const entries = (await readdir(absolute, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name, "en"),
  );
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(relative)));
    } else if (entry.isFile() && isPublicLanguageSource(relative)) {
      files.push({
        file: relative,
        source: await readFile(path.join(root, relative), "utf8"),
      });
    }
  }
  return files;
}

const files = [...(await sourceFiles("app")), ...(await sourceFiles("components"))];
const report = auditPublicLanguageOwnership(
  files,
  PUBLIC_LANGUAGE_LITERAL_ALLOWLIST,
);

for (const finding of report.violations) {
  console.error(
    `${finding.file}:${finding.line} bypasses the copy deck with ${finding.words} words: ${JSON.stringify(finding.literal)}`,
  );
}
for (const entry of report.staleAllowlist) {
  console.error(
    `${entry.file} has a stale public-language exemption: ${JSON.stringify(entry.literal)}`,
  );
}
for (const entry of report.invalidAllowlist) {
  console.error(
    `Invalid public-language exemption for ${entry.file || "<missing path>"}; an exact literal and reason are required.`,
  );
}

if (
  report.violations.length ||
  report.staleAllowlist.length ||
  report.invalidAllowlist.length
) {
  process.exitCode = 1;
} else {
  console.log(
    `Public language ownership verified across ${files.length} active public UI source files (${report.findings.length} reviewed long literals).`,
  );
}
