import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  experienceAudioManifestHash,
  validateExperienceAudioManifest,
} from "./lib/experience-audio-contract.mjs";

const manifestPath = path.resolve(
  "content/presentation/experience-audio.v1.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const errors = validateExperienceAudioManifest(manifest);
if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Experience audio manifest valid (${experienceAudioManifestHash(manifest).slice(0, 16)}).`,
  );
}
