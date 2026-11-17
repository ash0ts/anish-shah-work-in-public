import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseGearManifest, parseRigPrograms } from "../../lib/gear-model.ts";
import { parseCatalogPlan } from "../../lib/gear-reconciliation.ts";
import { buildCopyDeck } from "../lib/copy-deck.mjs";

/** Sheets interpret these prefixes as formulas even in a tab-delimited download. */
export function tsvCell(value) {
  const text = String(value ?? "").replace(/[\t\r\n]/gu, " ");
  return /^[\s]*[=+@-]/u.test(text) ? `'${text}` : text;
}
export function checklistRows(manifest, copy, catalog) {
  return [
    ["id", "action", "status", "brand", "model", "placement", "loop", "catalog URL", "catalog scope", "catalog task", "catalog search", "note"],
    ...manifest.items.map(item => [
      item.id,
      copy[`rig-export-${catalog.unmatched.find(entry => entry.id === item.id)?.resolution === "component" ? "component" : !item.modelConfirmed ? "confirm" : item.status === "owned" ? "owned" : item.status === "incoming" ? "incoming" : "planned"}-action`],
      item.status, item.brand, item.model, item.placement, item.loop ?? "",
      item.catalogUrl ?? "", item.catalogUrl ? item.catalogScope ?? "exact" : "",
      item.catalogUrl ? "matched" : catalog.unmatched.find(entry => entry.id === item.id).resolution,
      item.catalogQuery, copy[item.noteKey],
    ]),
  ];
}
export function catalogRequests(manifest, catalog, copy) {
  const lines = [
    `# ${copy["rig-export-title"]}`,
    "",
    `${catalog.checkedAt} · ${copy["rig-export-intro"]}`,
    "",
    copy["rig-export-form-body"], "",
    `[${copy["rig-export-form-label"]}](https://equipboard.com/items/new) · [${copy["rig-export-forum-label"]}](https://equipboard.com/forums/general/topics/post-your-item-add-requests-here)`,
    "",
    copy["rig-export-after-body"], "", copy["rig-export-configuration-body"],
  ];
  for (const resolution of ["request", "identify", "component"]) {
    lines.push("", `## ${copy[`rig-export-${resolution}-title`]}`);
    for (const entry of catalog.unmatched.filter(row => row.resolution === resolution)) {
      const item = manifest.items.find(row => row.id === entry.id);
      lines.push("", `### ${entry.title ?? `${item.brand} ${item.model}`}`, "", `${item.id} · ${item.status} · ${entry.category}`, "");
      lines.push(copy[`rig-export-${resolution}-body`], "");
      if (entry.parentId) lines.push(entry.parentId, "");
      lines.push(...entry.sourceUrls, "", copy[item.noteKey]);
    }
  }
  return lines.join("\n") + "\n";
}
export function asTsv(rows) { return rows.map(row => row.map(tsvCell).join("\t")).join("\n") + "\n"; }
export async function gearExports(root) {
  const manifest = parseGearManifest(JSON.parse(await readFile(path.join(root, "content/play/gear.v1.json"), "utf8")));
  const programs = parseRigPrograms(JSON.parse(await readFile(path.join(root, "content/play/rig-programs.v1.json"), "utf8")), manifest);
  const catalog = parseCatalogPlan(JSON.parse(await readFile(path.join(root, "content/play/equipboard-catalog.v1.json"), "utf8")), manifest);
  const { pages } = await buildCopyDeck(root);
  for (const item of manifest.items) if (!pages.play[item.noteKey]) throw new Error(`Missing gear note: ${item.id}`);
  const data = {
    manifest,
    catalog,
    notes: Object.fromEntries(manifest.items.map(item => [item.id, pages.play[item.noteKey]])),
    programs,
    programLabels: Object.fromEntries([...programs.presets, ...programs.op1Commands].map(p => [p.labelKey, pages.play[p.labelKey]])),
  };
  return new Map([
    ["gear.v1.json", JSON.stringify(data, null, 2) + "\n"],
    ["equipboard-checklist.tsv", asTsv(checklistRows(manifest, pages.play, catalog))],
    ["equipboard-catalog-requests.md", catalogRequests(manifest, catalog, pages.play)],
  ]);
}
