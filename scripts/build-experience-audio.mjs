import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalExperienceAudioManifest,
  experienceAudioManifestHash,
  validateExperienceAudioManifest,
} from "./lib/experience-audio-contract.mjs";

const sourcePath = path.resolve("content/presentation/experience-audio.v1.json");
const outputDirectory = path.resolve(
  process.argv[2] ?? "dist/experience-audio",
);
const source = JSON.parse(await readFile(sourcePath, "utf8"));
const errors = validateExperienceAudioManifest(source);
if (errors.length) throw new Error(errors.join("\n"));
const manifest = canonicalExperienceAudioManifest(source);
const hash = experienceAudioManifestHash(manifest);
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify({ ...manifest, contentHash: hash }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(`Built procedural audio manifest ${hash.slice(0, 16)}.`);
