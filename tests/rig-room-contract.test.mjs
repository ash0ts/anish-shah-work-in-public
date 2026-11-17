import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ROOM_OBJECT_CONTRACT, ROOM_OBJECT_IDS, roomObjectContract } from "../components/play/room-platform/room-object-contract.ts";
import { routeObject } from "../components/play/room-platform/room-history.ts";
import { ROOM_APPROACH_POSES } from "../components/play/room-3d/room-approach.ts";
import { BAKED_ROOM_OBJECT_IDS, ROOM_SCENE_OBJECTS } from "../components/play/room-3d/room-scene-layout.ts";
import { ROOM_RENDER_METRICS, ROOM_RENDER_BUDGET } from "../components/play/room-3d/room-render-metrics.ts";
import { buildRigRoomMesh } from "../components/play/room-3d/rig-room-model.ts";
import { RIG_OBJECT_CONTRACT, rigObject } from "../lib/rig-object-contract.ts";
import { rigObjectHref, selectRigScene } from "../lib/rig-scene.ts";
import { selectRigView } from "../lib/gear-model.ts";
import { objectFixtures } from "./browser/helpers/object-fixtures.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("all eight room destinations have navigation, focus, scene ownership and an approach pose", () => {
  assert.equal(ROOM_OBJECT_IDS.length, 8);
  assert.deepEqual(Object.keys(ROOM_SCENE_OBJECTS).sort(), [...ROOM_OBJECT_IDS].sort());
  assert.deepEqual(objectFixtures.map(o=>o.id), [...ROOM_OBJECT_IDS]);
  assert.deepEqual(Object.keys(ROOM_APPROACH_POSES).sort(), ROOM_OBJECT_CONTRACT.map(o=>o.approachPoseId).sort());
  for(const object of ROOM_OBJECT_CONTRACT) {
    assert.equal(routeObject(object.route), object.id);
    assert.equal(object.focusTarget, `[data-room-object-link="${object.id}"]`);
    assert.equal(object.meshRoot, `OBJ__${object.id}`);
  }
  assert.deepEqual(roomObjectContract("rig").contentSource, {kind:"gear-collection"});
  assert.equal(ROOM_OBJECT_CONTRACT.filter(o=>o.contentSource.kind==="connector").length,6);
  assert.equal(BAKED_ROOM_OBJECT_IDS.includes("rig"),false);
  assert.equal(ROOM_SCENE_OBJECTS.rig.kind,"code");
  for(const value of ["unknown","__proto__","constructor",null,{},["rig"]]) assert.equal(roomObjectContract(value),null);
});

test("music objects reference accepted gear without inventing ownership or duplicating pickup purchases", async () => {
  const manifest=JSON.parse(await source("content/play/gear.v1.json"));
  assert.equal(new Set(RIG_OBJECT_CONTRACT.map(o=>o.id)).size,7);
  assert.equal(new Set(RIG_OBJECT_CONTRACT.map(o=>o.gearId)).size,7);
  for(const object of RIG_OBJECT_CONTRACT) {
    assert.equal(manifest.items.filter(i=>i.id===object.gearId).length,1);
    assert.equal(rigObject(object.id),object);
    assert.equal("status" in object,false);
    assert.equal("catalogUrl" in object,false);
  }
  assert.equal(rigObject("ep127").kind,"controller");
  assert.equal(rigObject("fgn").gearId,"fgn-dark-odyssey");
  for(const value of ["__proto__","constructor",null,[],"pickups"]) assert.equal(rigObject(value),null);
  const exported=JSON.parse(await source("public/data/gear.v1.json"));
  assert.deepEqual(exported.objects,{schemaVersion:1,items:RIG_OBJECT_CONTRACT});
});

test("object actions preserve valid selections and resolve only to known local destinations", () => {
  for(const scene of ["home","tape","portable"]) for(const guitar of ["fgn","duo"])
  for(const bank of [1,2]) for(const deck of ["upper","lower"]) for(let preset=1;preset<=(bank===1?14:7);preset++) {
    const view={bank,deck,preset}, state={scene,guitar};
    for(const object of RIG_OBJECT_CONTRACT) {
      const href=rigObjectHref(object,view,state);
      if(object.action.kind==="inspect-gear") {assert.equal(href,`#gear-${object.gearId}`);continue;}
      const url=new URL(href,"https://example.com");
      assert.equal(url.pathname,"/play/rig");
      const query=Object.fromEntries(url.searchParams);
      assert.deepEqual(selectRigView(query),view);
      assert.deepEqual(selectRigScene(query),{...state,guitar:object.action.kind==="select-guitar"?object.action.guitar:guitar});
      assert.equal(url.hash,object.action.kind==="inspect-board"?"#workbench":"#music-corner");
    }
  }
});

test("the code-authored rig contains every device inside its hit proxy and stays within combined room budgets", () => {
  const mesh=buildRigRoomMesh();
  assert.deepEqual(mesh,buildRigRoomMesh(),"deterministic geometry");
  assert.deepEqual(mesh.objects.map(o=>o.id),RIG_OBJECT_CONTRACT.map(o=>o.id));
  assert.equal(mesh.positions.length,mesh.colors.length);
  assert.equal(mesh.positions.length%9,0);
  assert.ok(mesh.colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  const {hit,size}=ROOM_SCENE_OBJECTS.rig.layout;
  mesh.positions.forEach((value,i)=>assert.ok(Number.isFinite(value)&&Math.abs(value-hit[i%3])<=size[i%3]/2,`vertex ${i} is enclosed`));
  for(let i=0;i<mesh.positions.length;i+=9) {
    const a=mesh.positions.slice(i,i+3),b=mesh.positions.slice(i+3,i+6),c=mesh.positions.slice(i+6,i+9);
    const u=b.map((n,j)=>n-a[j]),v=c.map((n,j)=>n-a[j]);
    assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-10);
  }
  assert.equal(mesh.objects.reduce((sum,o)=>sum+o.vertexCount,0),mesh.positions.length/3);
  for(const object of mesh.objects) assert.ok(object.vertexCount>0);
  assert.equal(ROOM_RENDER_METRICS.hitProxyCount,8);
  assert.ok(ROOM_RENDER_METRICS.visibleDrawCallUpperBound<=ROOM_RENDER_BUDGET.visibleDrawCalls);
  assert.ok(ROOM_RENDER_METRICS.visibleTriangleUpperBound<=ROOM_RENDER_BUDGET.visibleTriangles);
  assert.ok(ROOM_RENDER_METRICS.materialSlots<=ROOM_RENDER_BUDGET.materialSlots);
});

test("rig loads through the literal room screen map and exposes the same return and selection semantics", async () => {
  const screen=await source("components/play/rig/RigScreen.tsx");
  const page=await source("app/play/rig/page.tsx");
  assert.match(page,/ROOM_SCREEN_LOADERS\.rig\(\)/);
  assert.match(screen,/data-room-screen data-object="rig"/);
  assert.match(screen,/<ScreenNavigation object=\{ROOM_OBJECT_BY_ID\.rig\}/);
  assert.match(screen,/<MatchCutSurface objectId="rig"/);
  const scene=await source("components/play/rig/RigScene.tsx");
  for(const {id} of RIG_OBJECT_CONTRACT) assert.match(scene,new RegExp(`data-rig-object="${id}"`));
  assert.match(scene,/const devices = RIG_OBJECT_CONTRACT/);
  const three=await source("components/play/room-3d/RigRoomObject.tsx");
  assert.doesNotMatch(three,/fetch\(|gear\.v1\.json|publicGearManifest|setInterval|Date\.now/);
  assert.match(three,/registerHit\("rig", mesh\)/);
});
