import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gearExports } from "./exports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const check = process.argv.includes("--check");
for (const [name, value] of await gearExports(root)) {
  const target = path.join(root, "public/data", name);
  if (check) {
    if (await readFile(target, "utf8") !== value) throw new Error(`${name} is stale; run npm run gear:export`);
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value, "utf8");
  }
}
console.log(check ? "Gear exports match their reviewed sources." : "Generated public gear data and Equipboard checklist.");
