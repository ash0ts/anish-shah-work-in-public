import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const DEPLOYABLE_MANIFEST_PATH =
  "dist/deployable-artifact-manifest.json";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function filesUnder(root, relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(root, relativePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Deployable artifacts cannot contain symlinks: ${relativePath}.`);
    }
    if (entry.isDirectory()) {
      files.push(...await filesUnder(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unsupported deployable artifact: ${relativePath}.`);
    }
  }
  return files;
}

export async function buildDeployableArtifactManifest(root) {
  const paths = [
    ...(await filesUnder(root, "dist/client")),
    ...(await filesUnder(root, "dist/server")),
  ].sort();
  if (paths.length === 0) {
    throw new Error("The deployable artifact set is empty.");
  }
  const artifacts = await Promise.all(
    paths.map(async (artifactPath) => {
      const bytes = await readFile(path.join(root, artifactPath));
      return {
        path: artifactPath,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      };
    }),
  );
  const artifactSetSha256 = sha256(
    `${artifacts.map((artifact) =>
      `${artifact.path}\0${artifact.bytes}\0${artifact.sha256}`
    ).join("\n")}\n`,
  );
  return {
    schemaVersion: "1.0",
    artifactSetSha256,
    fileCount: artifacts.length,
    totalBytes: artifacts.reduce((total, artifact) => total + artifact.bytes, 0),
    artifacts,
  };
}

export async function verifyDeployableArtifactManifest(root, manifest) {
  const expected = await buildDeployableArtifactManifest(root);
  if (
    !manifest ||
    manifest.schemaVersion !== "1.0" ||
    JSON.stringify(manifest) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "Deployable artifacts do not match the prepared deterministic manifest.",
    );
  }
  return expected;
}

export async function readVerifiedDeployableArtifactManifest(root) {
  let bytes;
  let manifest;
  try {
    bytes = await readFile(path.join(root, DEPLOYABLE_MANIFEST_PATH));
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("The deployable artifact manifest is missing or unreadable.");
  }
  await verifyDeployableArtifactManifest(root, manifest);
  return { bytes, manifest };
}
