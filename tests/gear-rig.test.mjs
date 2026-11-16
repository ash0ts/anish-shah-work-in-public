import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("gear manifest is public-safe and stable", async () => {
  const manifest = JSON.parse(await source("content/play/gear.v1.json"));
  assert.equal(manifest.version, 1);
  assert.ok(manifest.items.length >= 20);
  assert.equal(new Set(manifest.items.map(({ id }) => id)).size, manifest.items.length);
  const serialized = JSON.stringify(manifest).toLowerCase();
  for (const privateField of ["serialnumber", "serial_number", "purchaseprice", "receipt"]) {
    assert.equal(serialized.includes(privateField), false);
  }
  assert.ok(manifest.items.some(({ id, status }) => id === "boss-ns2" && status === "owned"));
  assert.ok(manifest.items.some(({ id, status }) => id === "schmidt-sa550xdm" && status === "incoming"));
});

test("rig route renders checked-in data without provider reads", async () => {
  const [page, screen, library] = await Promise.all([
    source("app/play/rig/page.tsx"),
    source("components/play/rig/RigScreen.tsx"),
    source("lib/gear.ts"),
  ]);
  assert.match(page, /publicGearManifest/);
  assert.match(screen, /orderedSignalChain/);
  assert.match(screen, /<ol className=\{styles\.chain\}>/);
  assert.match(screen, /<details>/);
  assert.doesNotMatch(`${page}\n${screen}\n${library}`, /fetch\(|loadConnector|from ["']three["']/);
});
