import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocumentation } from "./lib/docs-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await checkDocumentation({ root });

if (!result.ok) {
  for (const issue of result.issues) console.error(`- ${issue}`);
  console.error(`Documentation check failed with ${result.issues.length} issue(s).`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed for ${result.checked} Markdown files.`);
}
