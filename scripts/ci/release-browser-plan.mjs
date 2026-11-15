import { mkdir, writeFile } from "node:fs/promises";
import { changesBetween, releaseCoverage } from "../lib/release-coverage.mjs";

const baseSha = process.env.RELEASE_BASE_SHA;
const candidateSha = process.env.RELEASE_VALIDATED_SHA;
const coverage = releaseCoverage({
  baseSha, candidateSha, ...changesBetween(process.cwd(), baseSha, candidateSha),
  modes: JSON.parse(process.env.CANDIDATE_MODES || "null"),
  previousModes: JSON.parse(process.env.PREVIOUS_MODES || "null"),
});
await mkdir(".wrangler", { recursive: true });
await writeFile(".wrangler/release-coverage.json", JSON.stringify(coverage, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(coverage, null, 2));
