import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSetupResult, setupLocalEnvironment } from "./lib/local-dx.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const result = await setupLocalEnvironment({ root });
  console.log(formatSetupResult(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local setup failed.");
  process.exitCode = 1;
}
