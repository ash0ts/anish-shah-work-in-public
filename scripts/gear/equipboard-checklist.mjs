import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gearExports } from "./exports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.resolve(process.argv[2] ?? path.join(root, "dist/equipboard-import-checklist.tsv"));
const exports = await gearExports(root);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, exports.get("equipboard-checklist.tsv"), "utf8");
console.log(`Wrote Equipboard checklist to ${output}`);
