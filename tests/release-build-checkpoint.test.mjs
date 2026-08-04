import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDeployableArtifactManifest,
  DEPLOYABLE_MANIFEST_PATH,
} from "../scripts/lib/deployable-artifact-contract.mjs";
import {
  verifyReleaseBuildCheckpoint,
  writeReleaseBuildCheckpoint,
} from "../scripts/lib/release-build-checkpoint.mjs";

async function candidate() {
  const root = await mkdtemp(path.join(tmpdir(), "anish-release-build-"));
  await mkdir(path.join(root, "dist/client/.vite"), { recursive: true });
  await mkdir(path.join(root, "dist/server"), { recursive: true });
  await writeFile(path.join(root, "dist/client/index.js"), "client-v1\n");
  await writeFile(
    path.join(root, "dist/client/.vite/manifest.json"),
    '{"entry":"index.js"}\n',
  );
  await writeFile(path.join(root, "dist/server/index.js"), "server-v1\n");
  const manifest = await buildDeployableArtifactManifest(root);
  await writeFile(
    path.join(root, DEPLOYABLE_MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return root;
}

test("release build checkpoint verifies an untouched browser candidate", async () => {
  const root = await candidate();
  try {
    const written = await writeReleaseBuildCheckpoint(root);
    const verified = await verifyReleaseBuildCheckpoint(root);
    assert.equal(verified.artifactSetSha256, written.artifactSetSha256);
    assert.ok(
      verified.manifest.artifacts.some(
        ({ path: artifactPath }) =>
          artifactPath === "dist/client/.vite/manifest.json",
      ),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("release build checkpoint rejects content mutation", async () => {
  const root = await candidate();
  try {
    await writeReleaseBuildCheckpoint(root);
    await writeFile(path.join(root, "dist/server/index.js"), "server-v2\n");
    await assert.rejects(
      verifyReleaseBuildCheckpoint(root),
      /do not match the prepared deterministic manifest/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("release build checkpoint rejects an identical post-test rewrite", async () => {
  const root = await candidate();
  try {
    await writeReleaseBuildCheckpoint(root);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(path.join(root, "dist/server/index.js"), "server-v1\n");
    await assert.rejects(
      verifyReleaseBuildCheckpoint(root),
      /rewritten after browser validation began/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("release build checkpoint rejects final manifest replacement", async () => {
  const root = await candidate();
  try {
    await writeReleaseBuildCheckpoint(root);
    const manifestPath = path.join(root, DEPLOYABLE_MANIFEST_PATH);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(
      verifyReleaseBuildCheckpoint(root),
      /final deployable manifest changed|rewritten after browser validation began/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
