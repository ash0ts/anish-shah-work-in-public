import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseGearManifest, parseRigPrograms } from "../../lib/gear-model.ts";
import { buildCopyDeck } from "../lib/copy-deck.mjs";

/** Sheets interpret these prefixes as formulas even in a tab-delimited download. */
export function tsvCell(value) {
  const text = String(value ?? "").replace(/[\t\r\n]/gu, " ");
  return /^[\s]*[=+@-]/u.test(text) ? `'${text}` : text;
}
export function checklistRows(manifest, copy) {
  return [
    ["action", "status", "brand", "model", "placement", "loop", "catalog URL", "catalog search", "note"],
    ...manifest.items.map(item => [
      !item.modelConfirmed ? "Confirm exact model first" : item.status === "owned" ? "Add to owned collection" : item.status === "incoming" ? "Ordered — confirm receipt before marking owned" : "Wishlist only — purchase unconfirmed",
      item.status, item.brand, item.model, item.placement, item.loop ?? "",
      item.catalogUrl ?? "", item.catalogQuery, copy[item.noteKey],
    ]),
  ];
}
export function asTsv(rows) { return rows.map(row => row.map(tsvCell).join("\t")).join("\n") + "\n"; }
export async function gearExports(root) {
  const manifest = parseGearManifest(JSON.parse(await readFile(path.join(root, "content/play/gear.v1.json"), "utf8")));
  const programs = parseRigPrograms(JSON.parse(await readFile(path.join(root, "content/play/rig-programs.v1.json"), "utf8")), manifest);
  const { pages } = await buildCopyDeck(root);
  for (const item of manifest.items) if (!pages.play[item.noteKey]) throw new Error(`Missing gear note: ${item.id}`);
  const data = {
    manifest,
    notes: Object.fromEntries(manifest.items.map(item => [item.id, pages.play[item.noteKey]])),
    programs,
    programLabels: Object.fromEntries([...programs.presets, ...programs.op1Commands].map(p => [p.labelKey, pages.play[p.labelKey]])),
  };
  return new Map([
    ["gear.v1.json", JSON.stringify(data, null, 2) + "\n"],
    ["equipboard-checklist.tsv", asTsv(checklistRows(manifest, pages.play))],
  ]);
}
