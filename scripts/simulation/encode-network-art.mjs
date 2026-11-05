import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const input = process.argv[2];
if (!input)
  throw new Error("Supply the original transparent character atlas PNG.");
const source = await readFile(input);
const metadata = await sharp(source).metadata();
if (!metadata.hasAlpha || Math.abs(metadata.width / metadata.height - 1) > .05)
  throw new Error("A near-square alpha atlas is required.");
const props = process.argv[3] === "props";
const size = props ? 512 : 1024;
const output = `public/assets/simulation/network-${props ? "props" : "cast"}-v1.webp`;
await sharp(source)
  .resize(size, size, { kernel: "nearest", fit: "contain", background: {r: 0, g: 0, b: 0, alpha: 0} })
  .webp({ quality: 88, alphaQuality: 100, effort: 6 })
  .toFile(output);
const bytes = await readFile(output);
console.log(
  JSON.stringify({
    output,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }),
);
