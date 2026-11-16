import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(await readFile(path.join(root, "content/play/gear.v1.json"), "utf8"));
const output = process.argv[2] ?? path.join(root, "dist/equipboard-import-checklist.tsv");
const rows = [
  ["status", "brand", "model", "equipboard search", "note"],
  ...manifest.items.map((item) => [
    item.status,
    item.brand,
    item.model,
    item.equipboardQuery,
    item.note,
  ]),
];
const tsv = rows.map((row) => row.map((value) => String(value).replaceAll("\t", " ")).join("\t")).join("\n") + "\n";
await writeFile(output, tsv, "utf8");
console.log(`Wrote ${manifest.items.length} Equipboard checklist rows to ${output}`);
