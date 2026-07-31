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
    const rules = new Map(
      (run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]),
    );
    for (const result of run.results ?? []) {
      const rule = rules.get(result.ruleId);
      const rawSecuritySeverity = rule?.properties?.["security-severity"];
      const securitySeverity = Number.parseFloat(rawSecuritySeverity);
      const physicalLocation = result.locations?.[0]?.physicalLocation;
      const artifact = physicalLocation?.artifactLocation?.uri;
      const line = physicalLocation?.region?.startLine;
      findings.push({
        location: artifact ? `${artifact}${line ? `:${line}` : ""}` : null,
        level: result.level ?? "warning",
        message: result.message?.text ?? "CodeQL finding",
        ruleId: result.ruleId ?? "unknown-rule",
        securitySeverity: Number.isFinite(securitySeverity)
          ? securitySeverity
          : null,
      });
    }
  }
}

const blockingFindings = findings.filter(
  (finding) =>
    (finding.securitySeverity !== null && finding.securitySeverity >= 7) ||
    (finding.securitySeverity === null && finding.level === "error"),
);

if (findings.length > 0) {
  for (const finding of findings.slice(0, 50)) {
    const score =
      finding.securitySeverity === null
        ? ""
        : ` security ${finding.securitySeverity.toFixed(1)}`;
    const location = finding.location ? ` at ${finding.location}` : "";
    console.error(
      `[${finding.level}${score}] ${finding.ruleId}${location}: ${finding.message.replaceAll("\n", " ")}`,
    );
  }
  if (findings.length > 50) {
    console.error(`...and ${findings.length - 50} additional findings.`);
  }
}

if (blockingFindings.length > 0) {
  throw new Error(
    `CodeQL reported ${blockingFindings.length} high/critical finding(s).`,
  );
}

console.log(
  `CodeQL gate passed across ${sarifFiles.length} SARIF file(s); ${findings.length} non-blocking finding(s) were logged for review.`,
);
