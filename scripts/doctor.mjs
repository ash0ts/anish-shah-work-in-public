import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDoctorReport, formatDoctorReport } from "./lib/local-dx.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = process.argv.includes("--json");

try {
  const report = await createDoctorReport({ root });
  console.log(json ? JSON.stringify(report, null, 2) : formatDoctorReport(report));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local doctor failed.");
  process.exitCode = 1;
}
