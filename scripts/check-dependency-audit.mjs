import { spawnSync } from "node:child_process";

function audit(arguments_) {
  const result = spawnSync("npm", ["audit", "--json", ...arguments_], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error("npm audit did not return a readable JSON report.");
  }
  if (result.error) {
    throw new Error(`npm audit could not run: ${result.error.message}`);
  }
  if (
    typeof report !== "object" ||
    report === null ||
    !Number.isSafeInteger(report.auditReportVersion) ||
    typeof report.metadata?.vulnerabilities !== "object" ||
    report.metadata.vulnerabilities === null ||
    (Object.hasOwn(report, "error") && report.error !== null)
  ) {
    throw new Error("npm audit returned an unusable or registry-error report.");
  }
  const vulnerabilities = report.metadata.vulnerabilities;
  for (const severity of ["info", "low", "moderate", "high", "critical", "total"]) {
    const count = vulnerabilities[severity];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`npm audit omitted a valid ${severity} count.`);
    }
  }
  // npm audit exits 1 when advisories are present. Any other nonzero status is
  // a tooling/registry failure and must not be mistaken for a clean report.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`npm audit failed with status ${String(result.status)}.`);
  }
  return vulnerabilities;
}

const runtime = audit(["--omit=dev"]);
const full = audit([]);
const runtimeTotal = Number(runtime.total ?? 0);
const highOrCritical = Number(full.high ?? 0) + Number(full.critical ?? 0);

console.log(
  `Runtime advisories: ${runtimeTotal}; full-tree high/critical: ${highOrCritical}; ` +
    `full-tree moderate/low: ${Number(full.moderate ?? 0)}/${Number(full.low ?? 0)}.`,
);

if (runtimeTotal !== 0 || highOrCritical !== 0) {
  process.exitCode = 1;
}
