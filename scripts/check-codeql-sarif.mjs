import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];

if (!root) {
  throw new Error("Pass the CodeQL SARIF output directory.");
}

async function findSarifFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSarifFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".sarif")) {
      files.push(entryPath);
    }
  }

  return files;
}

const sarifFiles = await findSarifFiles(root);
if (sarifFiles.length === 0) {
  throw new Error("CodeQL completed without producing a SARIF result.");
}

const findings = [];
for (const sarifFile of sarifFiles) {
  const sarif = JSON.parse(await readFile(sarifFile, "utf8"));
  for (const run of sarif.runs ?? []) {
    for (const result of run.results ?? []) {
      findings.push({
        level: result.level ?? "warning",
        message: result.message?.text ?? "CodeQL finding",
        ruleId: result.ruleId ?? "unknown-rule",
      });
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings.slice(0, 50)) {
    console.error(
      `[${finding.level}] ${finding.ruleId}: ${finding.message.replaceAll("\n", " ")}`,
    );
  }
  if (findings.length > 50) {
    console.error(`...and ${findings.length - 50} additional findings.`);
  }
  throw new Error(`CodeQL reported ${findings.length} finding(s).`);
}

console.log(`CodeQL gate passed across ${sarifFiles.length} SARIF file(s).`);
