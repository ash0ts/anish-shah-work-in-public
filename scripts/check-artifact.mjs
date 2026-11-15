import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { validationIdentity, reusableReceipt } from "./lib/validation-receipt.mjs";

const root = process.cwd();
const suites = process.argv.includes("--bundle-only") ? ["bundle"] : ["bundle", "rendered"];
const receiptPath = "dist/validation-receipts.json";
let receipts = {};
try { receipts = JSON.parse(await readFile(receiptPath, "utf8")); } catch { /* A missing receipt means execute. */ }
for (const suite of suites) {
  const identity = await validationIdentity(root, suite);
  if (reusableReceipt(receipts[suite], identity)) {
    console.log(`${suite}: reused matching successful evidence (${Math.round(receipts[suite].durationMs)}ms saved)`);
    continue;
  }
  // Remove success before starting: interrupted or failed runs cannot reuse it.
  delete receipts[suite];
  await writeFile(receiptPath, JSON.stringify(receipts, null, 2) + "\n", { mode: 0o600 });
  const start = performance.now();
  const result = spawnSync(suite === "bundle" ? process.execPath : "npm", suite === "bundle" ? ["scripts/scan-release-bundle.mjs"] : ["run", "test:rendered"], { cwd: root, stdio: "inherit" });
  const durationMs = Math.round(performance.now() - start);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
  if (JSON.stringify(await validationIdentity(root, suite)) !== JSON.stringify(identity)) throw new Error("Validation inputs changed during execution.");
  receipts[suite] = { identity, status: "passed", durationMs, completedAt: new Date().toISOString() };
  await writeFile(receiptPath, JSON.stringify(receipts, null, 2) + "\n", { mode: 0o600 });
  console.log(`${suite}: passed in ${durationMs}ms`);
}
