import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { parseGearManifest, parseRigPrograms, selectRigView, loopItems } from "../lib/gear-model.ts";
import { gearExports, tsvCell } from "../scripts/gear/exports.mjs";
import { buildCopyDeck } from "../scripts/lib/copy-deck.mjs";
const root = path.resolve(import.meta.dirname, "..");
const source = p => readFile(path.join(root, p), "utf8");
const manifest = parseGearManifest(JSON.parse(await source("content/play/gear.v1.json")));
const programs = parseRigPrograms(JSON.parse(await source("content/play/rig-programs.v1.json")), manifest);

test("revision 07 preserves ownership, spare gear and exact confirmed models", () => {
  const byId = Object.fromEntries(manifest.items.map(i => [i.id, i]));
  assert.equal(manifest.build.revision, "07");
  assert.equal(manifest.build.state, "planned");
  assert.equal(byId["schmidt-sa550xdm"].status, "incoming");
  assert.equal(byId["gigrig-genx4lc"].kind, "power");
  assert.equal(byId["gigrig-genx4lc"].status, "planned");
  assert.equal(byId["tuner-unconfirmed"].model, "Lock In");
  assert.equal(byId["tuner-unconfirmed"].loop, undefined);
  assert.equal(byId["harmonic-tremolo-unconfirmed"].model, "3 Series Harmonic Trem");
  for (const id of ["boss-rc1", "canvas-power-6"]) { assert.equal(byId[id].status, "owned"); assert.equal(byId[id].placement, "offboard"); }
  assert.equal(byId["two-notes-opus"].power.volts, 12);
  assert.equal(byId["fishman-fluence"], undefined);
  assert.equal(byId["fgn-dark-odyssey"].kind, "guitar");
  assert.equal(byId["fgn-dark-odyssey"].status, "owned");
  assert.equal(byId["fgn-dark-odyssey"].instrument.strings, 6);
  assert.deepEqual(byId["fgn-dark-odyssey"].instrument.pickups, {brand:"Fishman",model:"Fluence Modern"});
  assert.deepEqual(byId["fgn-dark-odyssey"].legacyIds, ["fishman-fluence"]);
  assert.equal(byId["fender-duo-sonic"].instrument.year, null);
  assert.deepEqual(byId["fender-duo-sonic"].instrument.finish, {name:"Desert Sand",confirmed:false});
  assert.equal(byId["fender-duo-sonic"].catalogScope, "family");
  assert.equal(byId["fender-duo-sonic"].status, "owned");
  assert.equal(manifest.items.some(i => /hosta/i.test(i.model)), false);
});
test("private fields and unsafe catalog/profile links cannot enter the public feed", () => {
  for (const [target, key] of [["root", "serials"], ["item", "serialNumber"], ["item", "purchasePrice"], ["item", "receiptUrl"], ["profile", "email"]]) {
    const input = structuredClone(manifest);
    (target === "item" ? input.items[0] : target === "profile" ? input.profile : input)[key] = "private";
    assert.throws(() => parseGearManifest(input), /Unexpected gear field/);
  }
  for (const url of ["https://evil.example/items/x", "https://equipboard.com@evil.example/items/x", "javascript:alert(1)", "https://equipboard.com/items/x?token=secret"]) {
    const input = structuredClone(manifest); input.items[0].catalogUrl = url;
    assert.throws(() => parseGearManifest(input));
  }
  const input = structuredClone(manifest); input.items[0].catalogUrl = "https://equipboard.com/items/example";
  assert.equal(parseGearManifest(input).items[0].catalogUrl, input.items[0].catalogUrl);
  input.items[0].instrument.serialNumber = "private";
  assert.throws(() => parseGearManifest(input), /Unexpected gear field/);
  const aliasCollision = structuredClone(manifest);
  aliasCollision.items[0].legacyIds.push("boss-ns2");
  assert.throws(() => parseGearManifest(aliasCollision), /duplicate/);
});
test("audio loops exclude recording, power and tuner; gate follows compression", () => {
  const chain = loopItems(manifest.items);
  assert.deepEqual(chain.map(i => i.loop), [2,3,4,5,6,7,8,9,10,11,12]);
  assert.deepEqual(chain.slice(4,8).map(i => i.id), ["friedman-beod", "keeley-compressor-plus", "boss-ns2", "keeley-dyno-my-roto"]);
  assert.deepEqual(manifest.build.spareLoops, [1]);
  const duplicate = structuredClone(manifest); duplicate.items[0].loop = 8;
  assert.throws(() => parseGearManifest(duplicate), /duplicate/);
});
test("banks retain base sounds and tape commands cannot become guitar presets", () => {
  assert.deepEqual(programs.presets[0].loops, [7,8,12]);
  assert.deepEqual(programs.presets[4].loops, [6,7,8,12]);
  assert.deepEqual(programs.presets[13].loops, [2,11,12]);
  assert.deepEqual(programs.op1Commands.map(c => c.cc), [105,104,84,86,87,88,9]);
  assert.deepEqual(selectRigView({bank:"2",preset:"14",deck:"lower"}), {bank:2,preset:1,deck:"lower"});
  for (const preset of ["0","-1","1x","Infinity","99",["3","5"]]) assert.equal(selectRigView({preset}).preset,1);
  assert.equal(selectRigView({preset:"14"}).preset,14);
});
test("all notes and program labels have copy-deck owners", async () => {
  const { pages } = await buildCopyDeck(root);
  for (const i of manifest.items) assert.ok(pages.play[i.noteKey], i.noteKey);
  for (const p of [...programs.presets,...programs.op1Commands]) assert.ok(pages.play[p.labelKey],p.labelKey);
});
test("public downloads match current inventory and spreadsheet values are inert", async () => {
  for (const [name, value] of await gearExports(root)) assert.equal(await source(`public/data/${name}`),value);
  assert.equal(tsvCell("=HYPERLINK(1)"),"'=HYPERLINK(1)");
  assert.equal(tsvCell(" \t+1"),"'  +1");
  assert.equal(tsvCell("a\nb\tc"),"a b c");
  const dir = await mkdtemp(path.join(tmpdir(), "gear-export-"));
  try {
    const destination = path.join(dir,"nested/checklist.tsv");
    execFileSync(process.execPath,["scripts/gear/equipboard-checklist.mjs",destination],{cwd:root});
    const rows = (await readFile(destination,"utf8")).trimEnd().split("\n");
    assert.equal(rows.length,manifest.items.length+1);
    assert.match(rows.find(row => row.includes("GENX14")),/Wishlist only/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test("public rig uses local data and semantic navigation without provider reads", async () => {
  const files = await Promise.all(["app/play/rig/page.tsx","components/play/rig/RigScreen.tsx","lib/gear.ts"].map(source));
  assert.doesNotMatch(files.join("\n"),/fetch\(|loadConnector|from ["']three["']/);
  assert.match(files[1],/aria-current/);
  assert.match(files[1],/<details/);
  assert.match(files[1],/\/data\/gear\.v1\.json/);
  assert.match(files[0],/selectRigView\(query\)/);
});

test("music corner bounds selection and preserves the sound across setup/guitar changes", async () => {
  const { selectRigScene, rigHref } = await import("../lib/rig-scene.ts");
  assert.deepEqual(selectRigScene({}), {scene:"home",guitar:"fgn"});
  for (const value of ["bad","javascript:alert(1)",["tape","home"]]) {
    assert.equal(selectRigScene({scene:value}).scene,"home");
    assert.equal(selectRigScene({guitar:value}).guitar,"fgn");
  }
  const state=selectRigScene({scene:"portable",guitar:"duo"});
  const url=new URL(rigHref({bank:1,preset:14,deck:"lower"},state,{bank:2}),"https://example.com");
  const params=Object.fromEntries(url.searchParams);
  assert.deepEqual(selectRigView(params),{bank:2,preset:7,deck:"lower"});
  assert.deepEqual(selectRigScene(params),state);
  assert.equal(url.hash,"#music-corner");
});
test("scene paths separate amp input, OPUS recording, headphones and EP-35 line input", async () => {
  const { sceneRoute, sceneGuitars } = await import("../lib/rig-scene.ts");
  for (const guitar of ["fgn","duo"]) {
    const home=sceneRoute({scene:"home",guitar});
    const tape=sceneRoute({scene:"tape",guitar});
    const portable=sceneRoute({scene:"portable",guitar});
    assert.equal(home[0].from,sceneGuitars[guitar]);
    assert.equal(home.at(-1).to,"orange-crush-20rt");
    assert.equal(home.at(-1).fromPort,"OUT 2 / B");
    assert.equal(tape[1].internal,true);
    assert.equal(tape[1].to,"two-notes-opus");
    assert.equal(tape[2].fromPort,"PHONES / G");
    assert.equal(tape[2].toPort,"LINE IN");
    assert.equal(tape.at(-1).from,"op1-field");
    assert.equal(tape.at(-1).to,"headphones");
    assert.equal(portable.at(-1).to,"te-ep35");
    assert.equal(portable.at(-1).toPort,"LINE IN / 3.5 mm TRS");
    for (const edge of [...home,...tape,...portable]) {
      for (const id of [edge.from,edge.to]) assert.ok(id==='headphones'||manifest.items.some(i=>i.id===id));
      assert.notEqual(edge.from,"te-ep127");
      assert.doesNotMatch(edge.fromPort+edge.toPort,/USB|SPEAKER|FX RETURN/);
    }
  }
  const ep127=manifest.items.find(i=>i.id==='te-ep127');
  assert.equal(ep127.status,'owned');
  assert.equal(ep127.placement,'external');
  assert.equal(ep127.loop,undefined);
  assert.equal(manifest.items.find(i=>i.id==='te-ep35').status,'optional');
});
