import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { roomAtlasPlugin, validateRoomAtlasBytes } from "../components/play/room-3d/room-atlas.ts";
import { ROOM_OBJECT_IDS } from "../components/play/room-platform/room-object-contract.ts";
import { routeObject, markRoomHistoryEntry, clearRoomHistoryEntry, historyRoomObject, historyRoomDepth, historyRoomPath } from "../components/play/room-platform/room-history.ts";

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
  assert.deepEqual(Object.keys(manifest.props).sort(), [...ROOM_OBJECT_IDS].sort());
  for (const id of ROOM_OBJECT_IDS) {
    assert.equal(root.listNodes().filter(node => node.getName() === "OBJ__" + id).length, 1);
    assert.equal(root.listNodes().filter(node => node.getName() === "motion__" + id).length, 1);
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
  assert.deepEqual(manifest.finishedObjects, ["read", "play"]);
  for (const primitive of primitives) {
    assert.ok(primitive.getAttribute("COLOR_0"), "baked vertex lighting retained");
    assert.ok(primitive.getAttribute("TEXCOORD_0"), "atlas UVs retained");
    assert.ok(primitive.getMaterial().getExtension("KHR_materials_unlit"), "no live-lighting cost");
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
