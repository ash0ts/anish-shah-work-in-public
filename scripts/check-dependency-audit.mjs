import { spawnSync } from "node:child_process";

function audit(arguments_) {
  const result = spawnSync("npm", ["audit", "--json", ...arguments_], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error("npm audit did not return a readable JSON report.");
  }
  return report.metadata?.vulnerabilities ?? {};
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
