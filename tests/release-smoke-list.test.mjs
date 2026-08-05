import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BASE_RELEASE_SMOKE_TESTS,
  requiredReleaseSmokeTests,
} from "../scripts/lib/release-smoke-contract.mjs";
import {
  ROOM_PLAY_SMOKE_TESTS,
  TRAVEL_PLAY_SMOKE_TEST,
} from "../scripts/lib/release-contract.mjs";
import { releaseSmokeTestsFromPreparedPlan } from "../scripts/release-smoke-list.mjs";

const disabled = requiredReleaseSmokeTests({ travelAtlasMode: "disabled" });
const enabled = requiredReleaseSmokeTests({ travelAtlasMode: "atlas-v1" });

test("release smoke contract conditions only the Travel smoke check", () => {
  assert.deepEqual(disabled, [
    ...BASE_RELEASE_SMOKE_TESTS,
    ...ROOM_PLAY_SMOKE_TESTS,
  ]);
  assert.deepEqual(enabled, [...disabled, TRAVEL_PLAY_SMOKE_TEST]);
  assert.equal(new Set(enabled).size, enabled.length);
  assert.throws(
    () => requiredReleaseSmokeTests({ travelAtlasMode: "enabled" }),
    /disabled or atlas-v1/u,
  );
});

test("release:smoke:list derives IDs from the verified prepared plan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anish-release-smoke-"));
  const commitSha = "a".repeat(40);
  const configBytes = Buffer.from(
    `${JSON.stringify({
      vars: { RELEASE_SHA: commitSha, TRAVEL_ATLAS_MODE: "atlas-v1" },
    })}\n`,
  );
  const configSha256 = createHash("sha256").update(configBytes).digest("hex");
  await mkdir(path.join(root, "dist/server"), { recursive: true });
  await writeFile(path.join(root, "dist/server/wrangler.public.json"), configBytes);
  await writeFile(
    path.join(root, "dist/release-plan.json"),
    `${JSON.stringify({
      schemaVersion: "1.3",
      commitSha,
      travelAtlasMode: "atlas-v1",
      checksums: { preparedWorkerConfigSha256: configSha256 },
    })}\n`,
  );

  assert.deepEqual(await releaseSmokeTestsFromPreparedPlan(root), enabled);

  await writeFile(
    path.join(root, "dist/server/wrangler.public.json"),
    `${JSON.stringify({
      vars: { RELEASE_SHA: commitSha, TRAVEL_ATLAS_MODE: "disabled" },
    })}\n`,
  );
  await assert.rejects(
    releaseSmokeTestsFromPreparedPlan(root),
    /missing, stale, or does not match/u,
  );
});

test("release attestation consumes the shared smoke contract", async () => {
  const source = await readFile(
    new URL("../scripts/write-release-attestation.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /requiredReleaseSmokeTests/u);
  assert.doesNotMatch(source, /BASE_SMOKE_TESTS|BASE_RELEASE_SMOKE_TESTS/u);
});

test("release:smoke:list does not accept a caller-selected Travel mode", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../scripts/release-smoke-list.mjs", import.meta.url)),
      "--travel-atlas-mode",
      "atlas-v1",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /with no arguments/u);
});
