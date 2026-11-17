import { readFile, writeFile, mkdir, stat, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseGearManifest } from "../../lib/gear-model.ts";
import { equipboardUrl, parseCatalogPlan, parseEquipboardSnapshot, reconcileGear } from "../../lib/gear-reconciliation.ts";

const root = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const usage = "Use: node scripts/gear/reconcile-equipboard.mjs init --profile https://equipboard.com/users/NAME OR compare SNAPSHOT.json [--profile URL]";
const mode = args.shift();
const input = mode === "compare" ? args.shift() : undefined;
let explicitProfile;
if (args.length === 2 && args[0] === "--profile") explicitProfile = equipboardUrl(args[1], "users");
else if (args.length) throw new Error(usage);
if (!["init", "compare"].includes(mode) || (mode === "compare" && !input)) throw new Error(usage);
const manifestSource = await readFile(path.join(root, "content/play/gear.v1.json"), "utf8");
const manifest = parseGearManifest(JSON.parse(manifestSource));
const configuredProfile = manifest.profile.equipboardProfileUrl && equipboardUrl(manifest.profile.equipboardProfileUrl, "users");
if (configuredProfile && explicitProfile && configuredProfile !== explicitProfile) throw new Error("Profile conflicts with the reviewed manifest");
const profile = configuredProfile || explicitProfile;
if (!profile) throw new Error("Supply your actual profile with --profile; no Equipboard account is configured yet.");
const directory = path.join(root, "work/gear");
await mkdir(directory, { recursive: true, mode: 0o700 });
if (mode === "init") {
  const snapshot = { version: 1, profileUrl: profile, capturedAt: new Date().toISOString().slice(0, 10), source: "owner-reviewed", complete: false, items: [] };
  await writeFile(path.join(directory, "equipboard-snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log("Created work/gear/equipboard-snapshot.json. Add only entries you observe on your profile; the template is empty and partial.");
} else {
  if ((await stat(input)).size > 512_000) throw new Error("Snapshot exceeds 512 KB");
  const snapshot = parseEquipboardSnapshot(JSON.parse(await readFile(input, "utf8")), profile);
  const catalogSource = await readFile(path.join(root, "content/play/equipboard-catalog.v1.json"), "utf8");
  const plan = parseCatalogPlan(JSON.parse(catalogSource), manifest);
  const report = { ...reconcileGear(manifest, snapshot, plan), baseDigest: createHash("sha256").update(manifestSource).update(catalogSource).digest("hex") };
  const output = path.join(directory, "equipboard-review.json");
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await chmod(output, 0o600);
  const counts = Object.fromEntries([...new Set(report.findings.map(f => f.code))].map(code => [code, report.findings.filter(f => f.code === code).length]));
  console.log(JSON.stringify({ report: "work/gear/equipboard-review.json", mode: report.mode, empty: report.empty, counts }, null, 2));
}
