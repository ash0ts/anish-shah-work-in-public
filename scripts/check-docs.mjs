import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocumentation } from "./lib/docs-check.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
if (
  arguments_.length !== 0 &&
  (arguments_.length !== 2 || arguments_[0] !== "--root" || !arguments_[1])
) {
  throw new Error("Use check-docs.mjs with no arguments or --root <directory>.");
}
const root = arguments_.length === 2 ? path.resolve(arguments_[1]) : defaultRoot;
const result = await checkDocumentation({ root });

if (!result.ok) {
  for (const issue of result.issues) console.error(`- ${issue}`);
  console.error(`Documentation check failed with ${result.issues.length} issue(s).`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed for ${result.checked} Markdown files.`);
}
