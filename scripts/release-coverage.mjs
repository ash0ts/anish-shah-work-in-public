import { mkdir, writeFile } from "node:fs/promises";
import { changesBetween, releaseCoverage } from "./lib/release-coverage.mjs";

const baseSha = process.env.RELEASE_BASE_SHA;
const candidateSha = process.env.RELEASE_VALIDATED_SHA;
const modes = {
  simulationExperienceMode: process.env.SIMULATION_EXPERIENCE_MODE,
  simulationAiMode: process.env.SIMULATION_AI_MODE,
  travelAtlasMode: process.env.TRAVEL_ATLAS_MODE,
};
const previousModes = {
  simulationExperienceMode: process.env.RELEASE_PREVIOUS_SIMULATION_MODE,
  simulationAiMode: process.env.RELEASE_PREVIOUS_AI_MODE,
  travelAtlasMode: process.env.RELEASE_PREVIOUS_TRAVEL_MODE,
};
const plan = releaseCoverage({ baseSha, candidateSha, ...changesBetween(process.cwd(), baseSha, candidateSha), previousModes, modes });
await mkdir(".wrangler", { recursive: true });
await writeFile(".wrangler/release-coverage.json", `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(plan, null, 2));
