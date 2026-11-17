import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseGearManifest } from "../lib/gear-model.ts";
import { parseCatalogPlan, parseEquipboardSnapshot, reconcileGear } from "../lib/gear-reconciliation.ts";
import { catalogRequests, checklistRows } from "../scripts/gear/exports.mjs";
import { buildCopyDeck } from "../scripts/lib/copy-deck.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = p => readFile(path.join(root,p),"utf8");
const current = parseGearManifest(JSON.parse(await read("content/play/gear.v1.json")));
const currentCatalog = parseCatalogPlan(JSON.parse(await read("content/play/equipboard-catalog.v1.json")),current);
// Freeze comparison cases, not today's purchase status or shrinking catalog backlog.
const manifest = structuredClone(current);
manifest.items.find(i=>i.id==="gigrig-g3s").status="planned";
const fgn=manifest.items.find(i=>i.id==="fgn-dark-odyssey"); fgn.catalogUrl=null; delete fgn.catalogScope; fgn.modelConfirmed=false;
const genx=manifest.items.find(i=>i.id==="gigrig-genx14"); genx.catalogUrl=null; delete genx.catalogScope;
const fixtureRows={
  "fgn-dark-odyssey":{id:fgn.id,resolution:"identify",category:"Guitar",sourceUrls:[]},
  "gigrig-genx14":{id:genx.id,resolution:"request",title:"The GigRig GENX14",category:"Power",sourceUrls:["https://shop.thegigrig.com/products/gen-x-14"]}
};
const catalog=parseCatalogPlan({...currentCatalog,unmatched:manifest.items.filter(i=>!i.catalogUrl).map(i=>fixtureRows[i.id]??currentCatalog.unmatched.find(entry=>entry.id===i.id))},manifest);
const {pages:{play:copy}}=await buildCopyDeck(root);
const profile = "https://equipboard.com/users/test-owner";
const row = (id,status="owned") => ({catalogUrl:manifest.items.find(i=>i.id===id).catalogUrl,status});
const snapshot = (items=[],complete=false) => ({version:1,profileUrl:profile,capturedAt:"2026-11-16",source:"owner-reviewed",complete,items});
const compare = s => reconcileGear(manifest,parseEquipboardSnapshot(s,profile),catalog);

test("every missing item has a route; catalog requests distinguish products from configuration",()=>{
  assert.equal(catalog.unmatched.length,manifest.items.filter(i=>!i.catalogUrl).length);
  assert.equal(catalog.unmatched.find(i=>i.id==="genx14-adapter").parentId,"gigrig-genx14");
  assert.equal(catalog.unmatched.find(i=>i.id==="fgn-dark-odyssey").resolution,"identify");
  const incomplete=structuredClone(catalog);incomplete.unmatched.pop();
  assert.throws(()=>parseCatalogPlan(incomplete,manifest),/Every unmatched/);
  const duplicated=structuredClone(catalog);duplicated.unmatched.push(catalog.unmatched[0]);
  assert.throws(()=>parseCatalogPlan(duplicated,manifest),/duplicate/);
  const noSource=structuredClone(catalog);noSource.unmatched.find(i=>i.resolution==="request").sourceUrls=[];
  assert.throws(()=>parseCatalogPlan(noSource,manifest),/source/);
  const drafts=catalogRequests(manifest,catalog,copy);
  assert.match(drafts,/nothing has been submitted/);
  assert.match(drafts,/### The GigRig GENX14/);
  assert.match(drafts,/Please add this product/);
  const rows=checklistRows(manifest,copy,catalog);
  assert.equal(rows.find(row=>row[0]==="genx14-adapter")[1],copy["rig-export-component-action"]);
});
test("snapshot accepts canonical profile/items only and rejects duplicate, private and malformed input",()=>{
  const valid=snapshot([row("boss-ns2")]);
  assert.throws(()=>parseEquipboardSnapshot(valid,"https://equipboard.com/users/someone-else"),/mismatch/);
  for(const url of ["javascript:alert(1)","https://equipboard.com.evil.test/items/x","https://a:b@equipboard.com/items/x","https://equipboard.com/items/x?token=secret"]){
    const s=structuredClone(valid);s.items[0].catalogUrl=url;assert.throws(()=>parseEquipboardSnapshot(s,profile));
  }
  for(const field of ["email","serialNumber","receiptUrl"]){
    const s=structuredClone(valid);s.items[0][field]="private";assert.throws(()=>parseEquipboardSnapshot(s,profile),/Unexpected/);
  }
  assert.throws(()=>parseEquipboardSnapshot({...valid,capturedAt:"2026-02-30"},profile),/date/);
  assert.throws(()=>parseEquipboardSnapshot({...valid,items:Array(1001).fill(valid.items[0])},profile));
  assert.throws(()=>parseEquipboardSnapshot(snapshot([row("boss-ns2"),{...row("boss-ns2"),catalogUrl:row("boss-ns2").catalogUrl+"/"}]),profile),/Duplicate/);
  assert.equal(parseEquipboardSnapshot({...valid,profileUrl:profile+"/"},profile).profileUrl,profile);
});
test("comparison is deterministic and keeps owned, incoming, planned and saved meanings separate",()=>{
  const before=JSON.stringify(manifest);
  const input=snapshot([row("boss-ns2"),row("gigrig-g3s"),row("fender-duo-sonic","saved")]);
  const result=compare(input);
  assert.ok(result.findings.some(f=>f.localId==="boss-ns2"&&f.code==="match"));
  assert.ok(result.findings.some(f=>f.localId==="gigrig-g3s"&&f.code==="status-conflict"));
  assert.ok(result.findings.some(f=>f.localId==="fender-duo-sonic"&&f.code==="saved-status-unknown"));
  assert.deepEqual(compare(input),result);
  assert.equal(JSON.stringify(manifest),before);
  assert.equal(result.mode,"review-only");
});
test("absence never proposes deletion and partial capture never claims collection completeness",()=>{
  const partial=compare(snapshot());const complete=compare(snapshot([],true));
  assert.equal(partial.empty,true);
  assert.ok(partial.findings.some(f=>f.code==="not-seen-in-partial"));
  assert.equal(partial.findings.some(f=>f.code==="not-observed"),false);
  assert.ok(complete.findings.some(f=>f.code==="not-observed"));
  assert.doesNotMatch(JSON.stringify(complete),/delete|remove|apply/i);
});
test("new links require explicit identity review and never silently remap pickups or similar models",()=>{
  const url="https://equipboard.com/items/new-product";
  const report=compare(snapshot([{catalogUrl:url,status:"owned",localId:"fgn-dark-odyssey"}]));
  assert.ok(report.findings.some(f=>f.code==="identity-review"));
  assert.ok(compare(snapshot([{catalogUrl:url,status:"wishlist",localId:"gigrig-genx14"}])).findings.some(f=>f.code==="catalog-candidate"));
  assert.ok(compare(snapshot([{catalogUrl:url,status:"owned",localId:"fishman-fluence"}])).findings.some(f=>f.code==="legacy-id-review"));
  assert.ok(compare(snapshot([{catalogUrl:url,status:"owned"}])).findings.some(f=>f.code==="external-only"));
  assert.ok(compare(snapshot([{...row("boss-ns2"),localId:"gigrig-g3s"}])).findings.some(f=>f.code==="catalog-conflict"));
});
test("CLI stages an ignored report, refuses a wrong account, and leaves accepted sources untouched",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"gear-reconcile-"));
  try {
    for(const file of ["scripts/gear/reconcile-equipboard.mjs","lib/gear-model.ts","lib/gear-reconciliation.ts","content/play/gear.v1.json","content/play/equipboard-catalog.v1.json"]){
      await mkdir(path.dirname(path.join(dir,file)),{recursive:true});await copyFile(path.join(root,file),path.join(dir,file));
    }
    const script=path.join(dir,"scripts/gear/reconcile-equipboard.mjs");
    const run=args=>execFileSync(process.execPath,[script,...args],{cwd:dir,stdio:"pipe"});
    run(["init","--profile",profile]);
    assert.throws(()=>run(["init","--profile",profile]));
    const input=path.join(dir,"work/gear/equipboard-snapshot.json");
    await writeFile(input,JSON.stringify(snapshot([row("boss-ns2")])));
    run(["compare",input,"--profile",profile]);
    const output=path.join(dir,"work/gear/equipboard-review.json");
    const accepted=await readFile(output,"utf8");
    assert.equal(JSON.parse(accepted).baseDigest.length,64);
    assert.throws(()=>run(["compare",input,"--profile","https://equipboard.com/users/other"]));
    assert.equal(await readFile(output,"utf8"),accepted);
    assert.equal(await readFile(path.join(dir,"content/play/gear.v1.json"),"utf8"),await read("content/play/gear.v1.json"));
  } finally {await rm(dir,{recursive:true,force:true});}
});
