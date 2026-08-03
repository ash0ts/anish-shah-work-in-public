import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDeployableArtifactManifest,
  DEPLOYABLE_MANIFEST_PATH,
  verifyDeployableArtifactManifest,
} from "./lib/deployable-artifact-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, DEPLOYABLE_MANIFEST_PATH);
const mode = process.argv[2];
if (!new Set(["--write", "--check"]).has(mode)) {
  throw new Error("Use deployable-artifact-manifest.mjs --write or --check.");
}

if (mode === "--write") {
  const manifest = await buildDeployableArtifactManifest(root);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    `Prepared ${manifest.fileCount} deployable files (${manifest.artifactSetSha256}).`,
  );
} else {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("The deployable artifact manifest is missing or unreadable.");
  }
  await verifyDeployableArtifactManifest(root, manifest);
  console.log(
    `Deployable artifact manifest matches ${manifest.fileCount} files (${manifest.artifactSetSha256}).`,
  );
}
