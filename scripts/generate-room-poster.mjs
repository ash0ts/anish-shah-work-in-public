import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const [input] = process.argv.slice(2);
if (!input) {
  throw new Error(
    "Usage: node scripts/generate-room-poster.mjs <neutral-stage-screenshot.png>",
  );
}

const source = path.resolve(input);
const outputDirectory = path.resolve("public/assets/play");
const pipeline = sharp(source)
  .rotate()
  .resize({
    width: 1600,
    height: 1000,
    fit: "cover",
    position: "centre",
    withoutEnlargement: false,
  });

const [avif, webp] = await Promise.all([
  pipeline.clone().avif({ quality: 58, effort: 7 }).toBuffer(),
  pipeline.clone().webp({ quality: 78, effort: 6 }).toBuffer(),
]);

function contentName(format, bytes) {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  return `my-room-2001-neutral.${digest}.${format}`;
}

const outputs = [
  { bytes: avif, name: contentName("avif", avif) },
  { bytes: webp, name: contentName("webp", webp) },
];

await mkdir(outputDirectory, { recursive: true });
for (const output of outputs) {
  if (output.bytes.byteLength > 200_000) {
    throw new Error(`${output.name} exceeds the 200 KB poster budget.`);
  }
  await writeFile(path.join(outputDirectory, output.name), output.bytes);
}

process.stdout.write(
  `${JSON.stringify(
    {
      source,
      outputs: outputs.map((output) => ({
        path: `/assets/play/${output.name}`,
        bytes: output.bytes.byteLength,
      })),
    },
    null,
    2,
  )}\n`,
);
