import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { createDiorama, PROP_LAYOUT } from "./diorama-model.mjs";

// GLTFExporter needs only this Blob adapter for geometry-only Node exports.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
};
const scene = createDiorama();
let triangles = 0, draws = 0;
scene.traverse(node => {
  if (!node.isMesh) return;
  triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
  draws++;
});
if (triangles > 20_000 || draws > 30) throw new Error("Diorama exceeds Pocket geometry budget");
const raw = await new GLTFExporter().parseAsync(scene, { binary: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder,
});
await MeshoptEncoder.ready;
const doc = await io.readBinary(new Uint8Array(raw));
await doc.transform(weld(), dedup(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
const bytes = Buffer.from(await io.writeBinary(doc));
if (bytes.length > 350_000) throw new Error("Diorama exceeds asset transfer budget");
const digest = createHash("sha256").update(bytes).digest("hex");
const manifest = { schemaVersion: 1, assetPath: `/assets/play/diorama.${digest.slice(0, 12)}.glb`, sha256: digest,
  bytes: bytes.length, triangles, drawCalls: draws, materials: 1, props: PROP_LAYOUT };
const output = JSON.stringify(manifest, null, 2) + "\n";
const manifestPath = "components/play/room-3d/diorama.generated.json";
if (process.argv.includes("--check")) {
  if (await readFile(manifestPath, "utf8") !== output ||
      !bytes.equals(await readFile(`public${manifest.assetPath}`))) throw new Error("Diorama assets are stale");
} else {
  await mkdir("public/assets/play", { recursive: true });
  await writeFile(`public${manifest.assetPath}`, bytes);
  await writeFile(manifestPath, output);
}
console.log(JSON.stringify({ bytes: bytes.length, triangles, drawCalls: draws, sha256: digest }));
