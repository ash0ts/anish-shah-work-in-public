import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from "@gltf-transform/extensions";
import { dedup, meshopt, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const sourceDirectory = "assets/room/gothic-hardware";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const layout = JSON.parse(await readFile("scripts/room/gothic-layout.json", "utf8"));
const provenance = JSON.parse(await readFile(`${sourceDirectory}/provenance.json`, "utf8"));
for (const [field, path] of Object.entries({
  generatorSha256: "scripts/room/author-gothic-room.py",
  layoutSha256: "scripts/room/gothic-layout.json",
  sourceSha256: `${sourceDirectory}/room-source.glb`,
  editableSha256: `${sourceDirectory}/room.blend`,
  atlasSha256: `${sourceDirectory}/material-atlas.png`,
})) {
  if (hash(await readFile(path)) !== provenance[field]) throw new Error(`Room authoring drift: ${path}`);
}
if (provenance.authoringTool !== "Blender" || provenance.version !== "5.2.3 LTS" || !provenance.originalArtwork) {
  throw new Error("Unreviewed room authoring provenance");
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder,
});
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const doc = await io.readBinary(new Uint8Array(await readFile(`${sourceDirectory}/room-source.glb`)));
const root = doc.getRoot();
if (root.listTextures().length !== 1) throw new Error("Room requires exactly one embedded atlas");
const texture = root.listTextures()[0];
const image = await sharp(texture.getImage()).png({ compressionLevel: 9, palette: true, colours: 128, dither: 0 }).toBuffer();
const metadata = await sharp(image).metadata();
if (metadata.width !== 512 || metadata.height !== 512 || metadata.hasAlpha) throw new Error("Room atlas must be opaque 512×512");
texture.setImage(image).setMimeType("image/png");
// Blender's emission shader exports as an emissive PBR material. Make the
// runtime contract explicitly unlit; glTF multiplies COLOR_0 by the atlas.
const unlit = doc.createExtension(KHRMaterialsUnlit).setRequired(true);
for (const material of root.listMaterials()) {
  material.setBaseColorTexture(texture).setBaseColorFactor([1, 1, 1, 1])
    .setEmissiveTexture(null).setEmissiveFactor([0, 0, 0])
    .setExtension("KHR_materials_unlit", unlit.createUnlit());
}
await doc.transform(weld(), dedup(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
const primitives = root.listNodes().flatMap(node => node.getMesh()?.listPrimitives() ?? []);
const triangles = primitives.reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION").getCount()) / 3, 0);
const draws = primitives.length;
const materials = root.listMaterials().length;
if (triangles > 20_000 || draws > 30 || materials > 16) throw new Error("Diorama exceeds Pocket geometry budget");
const bytes = Buffer.from(await io.writeBinary(doc));
if (bytes.length > 350_000) throw new Error("Diorama exceeds asset transfer budget");
const digest = hash(bytes);
const manifest = { schemaVersion: 2, assetPath: `/assets/play/diorama.${digest.slice(0, 12)}.glb`, sha256: digest,
  bytes: bytes.length, triangles, drawCalls: draws, materials,
  texture: { width: 512, height: 512, bytes: image.length, sha256: hash(image), mediaType: "image/png" },
  authoring: { tool: provenance.authoringTool, version: provenance.version, sourceSha256: provenance.sourceSha256 },
  reviewStage: layout.reviewStage, finishedObjects: layout.finishedObjects, familiar: layout.familiar, props: layout.props, occluders: layout.occluders };
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
