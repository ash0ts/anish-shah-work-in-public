import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyCiChanges } from "../scripts/lib/ci-change-classifier.mjs";
import { changesBetween, gitRead, releaseCoverage, verifyCoverage, versionOnlyChange } from "../scripts/lib/release-coverage.mjs";
import { reusableReceipt, validationIdentity } from "../scripts/lib/validation-receipt.mjs";
import { assertBrowserArtifact, selectReleaseEvidence, runnerMinutes } from "../scripts/lib/release-resume.mjs";

const modes = { simulationExperienceMode: "disabled", simulationAiMode: "authored-only", travelAtlasMode: "atlas-v1" };
const input = { baseSha: "a".repeat(40), candidateSha: "b".repeat(40), previousModes: modes, modes };
const plan = (paths, overrides = {}) => releaseCoverage({ ...input, paths, ...overrides });

test("unknown paths cannot disappear inside a familiar UI change", () => {
  assert.equal(classifyCiChanges(["components/SiteHeader.tsx", "future-runtime/new.config"]).lane, "full");
  assert.equal(classifyCiChanges(["components/WorkFilters.tsx", "docs/testing.md"]).lane, "ui");
  assert.deepEqual(plan(["unknown.config"]).scopes, ["critical", "public", "objects", "room", "travel"]);
});

test("release scope expands for dependency, auth, shared runtime and mode changes", () => {
  for (const file of ["package-lock.json", "worker/index.ts", "app/api/studio/foo/route.ts", "vite.config.ts", "app/globals.css", "components/SiteHeader.tsx"]) {
    assert.equal(plan([file]).lane, "full");
    assert.ok(plan([file]).scopes.includes("travel"));
  }
  assert.deepEqual(plan(["docs/testing.md"]).scopes, ["critical"]);
  for (const file of [".github/runner/README.md", "content/copy/README.md", "releases/README.md"]) {
    assert.equal(classifyCiChanges([file]).lane, "docs");
    assert.deepEqual(plan([file]).scopes, ["critical"]);
  }
  assert.deepEqual(plan(["content/copy/pages/home.md"]).scopes, ["critical", "public"]);
  assert.deepEqual(plan(["components/play/room-3d/RoomStage.tsx"]).scopes, ["critical", "objects", "room"]);
  assert.deepEqual(plan(["lib/server/travel/media.ts"]).scopes, ["critical", "travel"]);
  assert.ok(!plan(["components/simulation/SimulationCampaign.tsx"]).scopes.includes("simulation"));
  assert.ok(plan([], { modes: { ...modes, simulationExperienceMode: "campaign-v1" } }).scopes.includes("simulation"));
  assert.throws(() => plan([], { modes: {} }), /feature modes/);
});

test("version-only exemption compares complete parsed package and lockfile contents", () => {
  for (const name of ["package.json", "package-lock.json"]) {
    const before = { version: "2.6.0", dependencies: { react: "19.2.9" }, packages: { "": { version: "2.6.0" }, "node_modules/react": { version: "19.2.9" } } };
    const after = structuredClone(before);
    after.version = "2.6.1";
    if (name === "package-lock.json") after.packages[""].version = "2.6.1";
    assert.equal(versionOnlyChange(name, JSON.stringify(before), JSON.stringify(after)), true);
    after.packages["node_modules/react"].version = "19.3.0";
    assert.equal(versionOnlyChange(name, JSON.stringify(before), JSON.stringify(after)), false);
  }
  const metadataOnlyPaths = ["package.json", "package-lock.json"];
  assert.equal(plan(metadataOnlyPaths, { metadataOnlyPaths }).lane, "metadata");
  assert.deepEqual(plan(metadataOnlyPaths, { metadataOnlyPaths }).scopes, ["critical"]);
  assert.throws(() => classifyCiChanges(["worker/index.ts"], { metadataOnlyPaths: ["worker/index.ts"] }), /Only verified package/);
});

test("coverage fingerprint rejects changed scope and preserves exact baseline", () => {
  const value = plan(["content/copy/pages/home.md"]);
  assert.equal(verifyCoverage(value), value);
  assert.throws(() => verifyCoverage({ ...value, scopes: ["critical"] }), /incomplete/);
  assert.throws(() => verifyCoverage({ ...value, baseSha: "c".repeat(40) }), /changed/);
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "anish-efficiency-"));
  gitRead(root, ["init", "-q"]);
  gitRead(root, ["config", "user.name", "Fixture"]);
  gitRead(root, ["config", "user.email", "fixture@example.test"]);
  gitRead(root, ["config", "commit.gpgsign", "false"]);
  for (const dir of ["components", "tests", "dist/client", "dist/server"]) await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, "components/Original.tsx"), "original");
  await writeFile(path.join(root, "tests/example.mjs"), "test-v1");
  await writeFile(path.join(root, "dist/client/index.js"), "client-v1");
  await writeFile(path.join(root, "dist/server/wrangler.json"), '{"mode":"preview"}');
  gitRead(root, ["add", "components", "tests"]);
  gitRead(root, ["commit", "-qm", "base"]);
  return root;
}

test("coverage includes earlier unreleased commits, not just the final repair", async () => {
  const root = await fixture();
  try {
    const baseSha = gitRead(root, ["rev-parse", "HEAD"]).trim();
    await mkdir(path.join(root, "components/play/room-3d"), { recursive: true });
    await writeFile(path.join(root, "components/play/room-3d/Room.tsx"), "room-v2");
    gitRead(root, ["add", "."]); gitRead(root, ["commit", "-qm", "feature"]);
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "docs/testing.md"), "repair notes");
    gitRead(root, ["add", "docs"]); gitRead(root, ["commit", "-qm", "last repair"]);
    const candidateSha = gitRead(root, ["rev-parse", "HEAD"]).trim();
    const change = changesBetween(root, baseSha, candidateSha);
    assert.ok(change.paths.includes("components/play/room-3d/Room.tsx"));
    assert.ok(change.paths.includes("docs/testing.md"));
    assert.throws(() => changesBetween(root, candidateSha, baseSha), /Cannot inspect/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("receipts bind SHA, bytes, configuration, suite, runtime and selected inputs", async () => {
  const root = await fixture();
  try {
    const identity = await validationIdentity(root, "rendered", { scopes: ["public"] });
    const receipt = { status: "passed", durationMs: 12, identity };
    assert.equal(reusableReceipt(receipt, identity), true);
    assert.equal(reusableReceipt({ ...receipt, status: "failed" }, identity), false);
    for (const key of Object.keys(identity)) {
      assert.equal(reusableReceipt(receipt, { ...identity, [key]: "changed" }), false, key);
    }
    await writeFile(path.join(root, "dist/server/wrangler.json"), '{"mode":"production"}');
    const config = await validationIdentity(root, "rendered", { scopes: ["public"] });
    assert.notEqual(config.configurationSha256, identity.configurationSha256);
    assert.equal(reusableReceipt(receipt, config), false);
    await writeFile(path.join(root, "tests/example.mjs"), "test-v2");
    assert.notEqual((await validationIdentity(root, "rendered")).suiteSha256, identity.suiteSha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resume does not reuse an older passing run after a newer failure", () => {
  const row = { head_sha: input.candidateSha, name: "Validate", path: ".github/workflows/ci.yml", event: "push", status: "completed", conclusion: "success", id: 1 };
  assert.equal(selectReleaseEvidence([row], input.candidateSha)[0].status, "passed");
  assert.equal(selectReleaseEvidence([row, { ...row, id: 2, conclusion: "failure" }], input.candidateSha)[0].status, "failed");
  assert.equal(selectReleaseEvidence([{ ...row, head_sha: input.baseSha }], input.candidateSha)[0].status, "missing");
  assert.equal(selectReleaseEvidence([{ ...row, path: "lookalike.yml" }], input.candidateSha)[0].status, "missing");
  assert.equal(runnerMinutes([{ started_at: "2026-11-15T10:00:00Z", completed_at: "2026-11-15T10:02:30Z" }, { started_at: null }]), 2.5);
});

test("release preparation binds Browser Quality to the producing Validate artifact and deployed baseline", () => {
  const expected = { sha: input.candidateSha, artifactSha256: "d".repeat(64), baseSha: input.baseSha };
  const report = { status: "passed", identity: { sourceSha: expected.sha, artifactSha256: expected.artifactSha256 }, phases: [{ status: "passed" }], coverage: plan(["content/copy/pages/home.md"]) };
  assert.doesNotThrow(() => assertBrowserArtifact(report, expected));
  assert.throws(() => assertBrowserArtifact(report, { ...expected, artifactSha256: "e".repeat(64) }), /validated build/);
  assert.throws(() => assertBrowserArtifact(report, { ...expected, baseSha: "c".repeat(40) }), /baseline/);
  assert.throws(() => assertBrowserArtifact({ ...report, status: "failed" }, expected), /validated build/);
  assert.throws(() => assertBrowserArtifact(report, { ...expected, modes: { ...modes, travelAtlasMode: "disabled" } }), /feature modes/);
});
