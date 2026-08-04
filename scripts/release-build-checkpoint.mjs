import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyReleaseBuildCheckpoint,
  writeReleaseBuildCheckpoint,
} from "./lib/release-build-checkpoint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2];
if (action !== "--write" && action !== "--check") {
  throw new Error("Use release-build-checkpoint.mjs --write or --check.");
}

const checkpoint =
  action === "--write"
    ? await writeReleaseBuildCheckpoint(root)
    : await verifyReleaseBuildCheckpoint(root);

console.log(
  `${action === "--write" ? "Recorded" : "Verified"} release browser candidate ` +
    `${checkpoint.artifactSetSha256}.`,
);
