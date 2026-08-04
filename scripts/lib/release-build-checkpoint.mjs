import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEPLOYABLE_MANIFEST_PATH,
  readVerifiedDeployableArtifactManifest,
} from "./deployable-artifact-contract.mjs";

export const RELEASE_BUILD_CHECKPOINT_PATH =
  ".wrangler/release-build-checkpoint.json";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function artifactIdentity(root, artifacts) {
  return Promise.all(
    artifacts.map(async ({ path: artifactPath }) => {
      const stats = await lstat(path.join(root, artifactPath), { bigint: true });
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error(`Release candidate artifact is not a regular file: ${artifactPath}.`);
      }
      return {
        path: artifactPath,
        bytes: Number(stats.size),
        modifiedNanoseconds: stats.mtimeNs.toString(),
      };
    }),
  );
}

export async function writeReleaseBuildCheckpoint(root) {
  const { bytes: manifestBytes, manifest } =
    await readVerifiedDeployableArtifactManifest(root);
  const identityPaths = [
    ...manifest.artifacts,
    { path: DEPLOYABLE_MANIFEST_PATH },
  ];
  const checkpoint = {
    schemaVersion: "1.0",
    artifactSetSha256: manifest.artifactSetSha256,
    deployableManifestSha256: sha256(manifestBytes),
    artifacts: await artifactIdentity(root, identityPaths),
    manifest,
  };
  const destination = path.join(root, RELEASE_BUILD_CHECKPOINT_PATH);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(checkpoint, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return checkpoint;
}

export async function verifyReleaseBuildCheckpoint(root) {
  let checkpoint;
  try {
    checkpoint = JSON.parse(
      await readFile(path.join(root, RELEASE_BUILD_CHECKPOINT_PATH), "utf8"),
    );
  } catch {
    throw new Error("The release build checkpoint is missing or unreadable.");
  }
  if (
    checkpoint?.schemaVersion !== "1.0" ||
    checkpoint.artifactSetSha256 !== checkpoint.manifest?.artifactSetSha256 ||
    !/^[a-f0-9]{64}$/.test(checkpoint.deployableManifestSha256 ?? "")
  ) {
    throw new Error("The release build checkpoint is malformed.");
  }
  const { bytes: currentManifestBytes, manifest: currentManifest } =
    await readVerifiedDeployableArtifactManifest(root);
  if (
    sha256(currentManifestBytes) !== checkpoint.deployableManifestSha256 ||
    JSON.stringify(currentManifest) !== JSON.stringify(checkpoint.manifest)
  ) {
    throw new Error("The final deployable manifest changed after validation began.");
  }
  const currentIdentity = await artifactIdentity(root, [
    ...checkpoint.manifest.artifacts,
    { path: DEPLOYABLE_MANIFEST_PATH },
  ]);
  if (JSON.stringify(currentIdentity) !== JSON.stringify(checkpoint.artifacts)) {
    throw new Error(
      "Release candidate files were rewritten after browser validation began.",
    );
  }
  return checkpoint;
}
