import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { roomAtlasPlugin, validateRoomAtlasBytes } from "../components/play/room-3d/room-atlas.ts";
import { BAKED_ROOM_OBJECT_IDS } from "../components/play/room-3d/room-scene-layout.ts";
import { ROOM_OBJECT_IDS } from "../components/play/room-platform/room-object-contract.ts";
import { roomFamiliarPose, roomPropResponse, settleRoomPose } from "../components/play/room-3d/room-prop-response.ts";
import { routeObject, markRoomHistoryEntry, clearRoomHistoryEntry, historyRoomObject, historyRoomDepth, historyRoomPath, roomReturnDepth } from "../components/play/room-platform/room-history.ts";

test("the optimized first-party asset matches its hash, registry, and actual mesh budgets", async () => {
  const manifest = JSON.parse(await readFile(new URL("../components/play/room-3d/diorama.generated.json", import.meta.url)));
  const bytes = await readFile(new URL("../public" + manifest.assetPath, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256);
  assert.equal(bytes.length, manifest.bytes);
  assert.ok(bytes.length < 350_000);
  await MeshoptDecoder.ready;
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder }).readBinary(new Uint8Array(bytes));
  const root = document.getRoot();
  assert.deepEqual(Object.keys(manifest.props).sort(), [...BAKED_ROOM_OBJECT_IDS].sort());
  const familiar = root.listNodes().filter(node => node.getName() === "room-familiar");
  assert.equal(familiar.length, 1, "one decorative familiar, not another destination");
  assert.equal(familiar[0].getMesh(), null, "preserve the authored reaction pivot");
  assert.equal(familiar[0].listChildren().length, 1);
  assert.ok(familiar[0].listChildren()[0].getMesh());
  familiar[0].getTranslation().forEach((value, index) =>
    assert.ok(Math.abs(value - manifest.familiar.position[index]) < .00001));
  for (const id of BAKED_ROOM_OBJECT_IDS) {
    assert.equal(root.listNodes().filter(node => node.getName() === "OBJ__" + id).length, 1);
    assert.equal(root.listNodes().filter(node => node.getName() === "motion__" + id).length, 1);
    const body = root.listNodes().find(node => node.getName() === "body__" + id);
    const bodyTriangles = body.getMesh().listPrimitives().reduce((sum, primitive) => sum + primitive.getIndices().getCount()/3, 0);
    assert.ok(bodyTriangles > 200, `${id} has an authored body, not a wireframe placeholder`);
    const motion = root.listNodes().find(node => node.getName() === "motion__" + id);
    assert.equal(motion.getMesh(),null,"quantization must not recenter the animation pivot");
    assert.equal(motion.listChildren().length,1);
    assert.ok(motion.listChildren()[0].getMesh());
    const pivot = manifest.props[id].motionPivot ?? [0,0,0];
    motion.getTranslation().forEach((value, index) => assert.ok(Math.abs(value-pivot[index]) < .00001, `${id} motion pivot`));
  }
  const primitives = root.listNodes().flatMap(node => node.getMesh()?.listPrimitives() ?? []);
  const triangles = primitives.reduce((sum, primitive) => {
    assert.equal(primitive.getMode(), 4);
    return sum + (primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION").getCount()) / 3;
  }, 0);
  assert.equal(triangles, manifest.triangles);
  assert.equal(primitives.length, manifest.drawCalls);
  assert.equal(root.listMaterials().length, manifest.materials);
  assert.ok(triangles <= 20_000);
  assert.ok(primitives.length <= 30);
  assert.ok(root.listMaterials().length <= 16);
  assert.equal(root.listTextures().length, 1, "one original embedded atlas only");
  const texture = root.listTextures()[0];
  assert.equal(texture.getMimeType(), "image/png");
  const atlas = Buffer.from(texture.getImage());
  assert.equal(createHash("sha256").update(atlas).digest("hex"), manifest.texture.sha256);
  assert.equal(atlas.length, manifest.texture.bytes);
  const metadata = await sharp(atlas).metadata();
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.hasAlpha, false);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.ok(atlas.length < 100_000);
  validateRoomAtlasBytes(Uint8Array.from(atlas).buffer);
  assert.equal(manifest.authoring.tool, "Blender");
  assert.equal(manifest.authoring.version, "5.2.3 LTS");
  assert.equal(manifest.reviewStage, "complete");
  assert.deepEqual([...manifest.finishedObjects].sort(), [...BAKED_ROOM_OBJECT_IDS].sort());
  for (const primitive of primitives) {
    assert.ok(primitive.getAttribute("COLOR_0"), "baked vertex lighting retained");
    assert.ok(primitive.getAttribute("TEXCOORD_0"), "atlas UVs retained");
    assert.ok(primitive.getMaterial().getExtension("KHR_materials_unlit"), "no live-lighting cost");
  }
});

test("the familiar glances toward objects, handles interruption, then stops requesting frames", () => {
  assert.deepEqual(roomFamiliarPose(null), { yaw: 0, roll: -0 });
  assert.deepEqual(roomFamiliarPose(NaN), roomFamiliarPose(null));
  assert.deepEqual(roomFamiliarPose(Infinity), roomFamiliarPose(null));
  assert.equal(roomFamiliarPose(-20).yaw, -.45);
  assert.equal(roomFamiliarPose(20).yaw, .45);
  assert.equal(roomFamiliarPose(20).roll, -.08);
  let current = 0;
  const right = roomFamiliarPose(3).yaw;
  for (let i = 0; i < 5; i++) current = settleRoomPose(current, right, 1/60);
  assert.ok(current > 0 && current < right);
  const interrupted = current;
  current = settleRoomPose(current, -.45, 1/60);
  assert.ok(current < interrupted && current > -.45, "retarget from the actual pose without snapping");
  for (let i = 0; i < 120; i++) current = settleRoomPose(current, -.45, 1/60);
  assert.equal(current, -.45, "exactly settled: no idle invalidation");
  for (let i = 0; i < 120; i++) current = settleRoomPose(current, 0, 1/60);
  assert.equal(current, 0);
  assert.equal(settleRoomPose(.1, 0, 20), settleRoomPose(.1, 0, .05));
  assert.equal(settleRoomPose(.1, 0, NaN), .1);
});

test("every prop response is bounded, reversible, and uses the intended axis", () => {
  for (const id of ROOM_OBJECT_IDS) {
    assert.deepEqual(roomPropResponse(id,-1), roomPropResponse(id,0));
    assert.deepEqual(roomPropResponse(id,2), roomPropResponse(id,1));
    assert.deepEqual(roomPropResponse(id,NaN), roomPropResponse(id,0));
    const idle = roomPropResponse(id,0);
    assert.ok(idle.offsetY === 0);
    assert.ok(idle.offsetZ === 0);
    assert.ok(idle.yaw === 0);
    assert.equal(idle.scale,1);
  }
  assert.equal(roomPropResponse("listen",1).offsetY,-.025);
  assert.equal(roomPropResponse("read",1).offsetZ,.2);
  assert.equal(roomPropResponse("collect",1).yaw,-.6);
  assert.equal(roomPropResponse("travel",1).yaw,Math.PI*.7);
  for (const id of ["watch","play","move"]) {
    assert.equal(roomPropResponse(id,0).visible,false);
    assert.equal(roomPropResponse(id,1).visible,true);
  }
});

test("atlas decoding rejects remote sources and oversized images before allocation", async () => {
  assert.throws(() => validateRoomAtlasBytes(new ArrayBuffer(100_001)));
  assert.throws(() => validateRoomAtlasBytes(new ArrayBuffer(33)));
  const png = new ArrayBuffer(33);
  const view = new DataView(png);
  for (const [offset, value] of [[0,0x89504e47],[4,0x0d0a1a0a],[8,13],[12,0x49484452],[16,512],[20,512]]) view.setUint32(offset,value);
  validateRoomAtlasBytes(png);
  view.setUint32(16,8192);
  assert.throws(() => validateRoomAtlasBytes(png));
  for (const source of [{uri:"https://example.test/image.png"},{bufferView:0,mimeType:"image/svg+xml"}]) {
    const plugin=roomAtlasPlugin({json:{textures:[{source:0}],images:[source]},getDependency:()=>{throw Error("must not fetch");}});
    await assert.rejects(plugin.loadTexture(0), /single embedded PNG/);
  }
});

test("atlas decoding preserves un-oriented pixels without deprecated bitmap options", async () => {
  const bytes = new ArrayBuffer(33);
  const view = new DataView(bytes);
  for (const [offset, value] of [[0,0x89504e47],[4,0x0d0a1a0a],[8,13],[12,0x49484452],[16,512],[20,512]]) view.setUint32(offset,value);
  const previous = globalThis.createImageBitmap;
  let closed = false;
  const bitmap = { width: 512, height: 512, close() { closed = true; } };
  globalThis.createImageBitmap = async (blob, options) => {
    assert.equal(blob.type, "image/png");
    assert.deepEqual(options, { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "from-image" });
    return bitmap;
  };
  try {
    const plugin = roomAtlasPlugin({ json: { textures: [{ source: 0 }], images: [{ bufferView: 0, mimeType: "image/png" }] }, getDependency: async () => bytes });
    const texture = await plugin.loadTexture(0);
    assert.equal(texture.image, bitmap);
    assert.equal(texture.flipY, false);
    texture.dispose();
    assert.equal(closed, true);
  } finally {
    if (previous) globalThis.createImageBitmap = previous;
    else delete globalThis.createImageBitmap;
  }
});

test("room history recognizes only closed routes and preserves router-owned state", () => {
  for (const id of ROOM_OBJECT_IDS) assert.equal(routeObject("/play/" + id), id);
  assert.equal(routeObject("/play/travel/trips/tokyo"), "travel");
  for (const path of ["/play", "/play/nope", "/work/watch", "/play/watch/more"]) assert.equal(routeObject(path), null);
  const previous = globalThis.window;
  const history = { state: { router: "preserve" }, replaceState(next) { this.state = next; } };
  globalThis.window = { history, location: { pathname: "/play/watch", href: "https://example.test/play/watch" } };
  try {
    markRoomHistoryEntry("watch", 2);
    assert.equal(historyRoomObject(), "watch");
    assert.equal(historyRoomDepth(), 2);
    assert.equal(historyRoomPath(), "/play/watch");
    clearRoomHistoryEntry();
    assert.deepEqual(history.state, { router: "preserve" });
    assert.equal(historyRoomObject(), null);
    assert.equal(historyRoomDepth(), null);
  } finally { globalThis.window = previous; }
});

test("an immediate nested-route return resolves fresh history without double-counting", () => {
  const atlas = "/play/travel";
  const trip = "/play/travel/trips/tokyo";
  // URL committed; passive route bookkeeping has not run yet.
  assert.equal(roomReturnDepth(trip, atlas, 1, null, null), 2);
  assert.equal(roomReturnDepth(trip, atlas, 1, atlas, 1), 2);
  // Either the history marker or the effect has caught up before the frame.
  assert.equal(roomReturnDepth(trip, atlas, 1, trip, 2), 2);
  assert.equal(roomReturnDepth(trip, trip, 2, null, null), 2);
  assert.equal(roomReturnDepth(trip, trip, 2, trip, 2), 2);
  assert.equal(roomReturnDepth(atlas, trip, 2, atlas, 1), 1);
});
