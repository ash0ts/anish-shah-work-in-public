import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Re-encode generated inputs without metadata; retain alpha and proportions.
// The media atlas is an exact 2 × 2 sheet, not a runtime image transform.
const [atlas, companion] = process.argv.slice(2);
if (!atlas || !companion)
  throw new Error("Supply atlas and companion PNG inputs.");
await mkdir("public/assets/simulation", { recursive: true });
for (const [input, name, width] of [
  [atlas, "media-atlas-v1", 1024],
  [companion, "companion-cobalt-v1", 480],
]) {
  const source = await readFile(input);
  const metadata = await sharp(source).metadata();
  if (
    !metadata.hasAlpha ||
    (name.startsWith("media") && metadata.width !== metadata.height)
  )
    throw new Error("Artwork must have alpha; atlas must be square.");
  const output = `public/assets/simulation/${name}.webp`;
  await sharp(source)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 100, effort: 6 })
    .toFile(output);
  const bytes = await readFile(output);
  console.log(
    JSON.stringify({
      output,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
}
