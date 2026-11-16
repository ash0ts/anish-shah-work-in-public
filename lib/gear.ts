import manifestJson from "@/content/play/gear.v1.json";
import programsJson from "@/content/play/rig-programs.v1.json";
import { parseGearManifest, parseRigPrograms } from "./gear-model";

const manifest = parseGearManifest(manifestJson);
const programs = parseRigPrograms(programsJson, manifest);

export function publicGearManifest() { return manifest; }
export function publicRigPrograms() { return programs; }
