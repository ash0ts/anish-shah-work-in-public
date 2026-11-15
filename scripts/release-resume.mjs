import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { assertBrowserArtifact, selectReleaseEvidence, runnerMinutes } from "./lib/release-resume.mjs";
import { gitRead, digest } from "./lib/release-coverage.mjs";
import { readVerifiedDeployableArtifactManifest } from "./lib/deployable-artifact-contract.mjs";
import { verifyReleaseBuildCheckpoint } from "./lib/release-build-checkpoint.mjs";
import { CANONICAL_GITHUB_REPOSITORY, githubRepositoryFromRemoteUrl } from "./lib/release-contract.mjs";

const root = process.cwd();
const sha = gitRead(root, ["rev-parse", "HEAD"]).trim();
if (process.env.RELEASE_VALIDATED_SHA && process.env.RELEASE_VALIDATED_SHA !== sha) throw new Error("Release SHA differs from HEAD.");
const repository = githubRepositoryFromRemoteUrl(gitRead(root, ["remote", "get-url", "origin"]).trim());
if (repository !== CANONICAL_GITHUB_REPOSITORY) throw new Error("Release repository mismatch.");
function gh(...args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("GitHub evidence could not be read. No release action was taken.");
  return result.stdout;
}
const runList = JSON.parse(gh("api", `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100`)).workflow_runs;
const evidence = selectReleaseEvidence(runList, sha);
const timings = [];
for (const entry of evidence.filter(({ runId }) => runId)) {
  const jobs = JSON.parse(gh("api", `repos/${repository}/actions/runs/${entry.runId}/jobs?per_page=100`)).jobs;
  timings.push({ kind: entry.kind, runnerMinutes: Number(runnerMinutes(jobs).toFixed(2)) });
}
const state = { schemaVersion: 1, sha, evidence, timings, totalRunnerMinutes: Number(timings.reduce((sum, row) => sum + row.runnerMinutes, 0).toFixed(2)) };
let previous;
try { previous = JSON.parse(await readFile(".wrangler/release-session.json", "utf8")); } catch {}
const configurationSha256 = digest(Object.fromEntries(
  Object.entries(process.env)
    .filter(([key]) => /^(?:RELEASE_|SIMULATION_|TRAVEL_|SITE_URL$|PRODUCTION_SITE_URL$|CLOUDFLARE_)/.test(key))
    .sort(([a], [b]) => a.localeCompare(b)),
));
// A read-only status check must not discard resumable preparation merely because
// its shell does not contain the operator's release configuration.
if (previous?.sha === sha && digest(previous.evidence) === digest(evidence)) state.prepared = previous.prepared;
await mkdir(".wrangler", { recursive: true });
await writeFile(".wrangler/release-session.json", JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(state, null, 2));
if (evidence.some(({ status }) => status !== "passed")) {
  console.log("Next: finish the missing or failed exact-SHA evidence. Executed failures are blocking; capacity failures are not passes. This command does not redispatch jobs.");
  process.exitCode = 1;
} else if (!process.argv.includes("--prepare")) {
  console.log("Next: supply the current owner publication/health checkpoint, previous Worker version, D1 bookmark and release configuration, then run npm run release:resume -- --prepare.");
} else {
  if (gitRead(root, ["status", "--porcelain"]).trim() || gitRead(root, ["rev-parse", "@{upstream}"]).trim() !== sha || gitRead(root, ["branch", "--show-current"]).trim() !== "main") throw new Error("Preparation requires clean, pushed main.");
  if (state.prepared?.configurationSha256 === configurationSha256) {
    const checkpoint = await verifyReleaseBuildCheckpoint(root);
    const planBytes = await readFile("dist/release-plan.json", "utf8");
    if (checkpoint.artifactSetSha256 !== state.prepared.artifactSha256 || digest(planBytes) !== state.prepared.planSha256) throw new Error("Prepared candidate changed; inspect it before preparing again.");
    console.log("The exact prepared candidate is unchanged. Resume the next guarded runbook step; no download, rebuild or validation repeated.");
    process.exit(0);
  }
  const validate = evidence.find(({ kind }) => kind === "validate");
  const artifacts = JSON.parse(gh("api", `repos/${repository}/actions/runs/${validate.runId}/artifacts`)).artifacts;
  const artifact = artifacts.find(({ name, expired }) => name === `validated-dist-${sha}` && !expired);
  if (!artifact) throw new Error("Validate did not produce a current build; dispatch full Validate for this SHA.");
  const temporary = await mkdtemp(path.join(tmpdir(), "anish-validated-artifact-"));
  gh("run", "download", String(validate.runId), "--repo", repository, "--name", artifact.name, "--dir", path.join(temporary, "dist"));
  const { manifest } = await readVerifiedDeployableArtifactManifest(temporary);
  const browser = evidence.find(({ kind }) => kind === "browser");
  const browserDirectory = path.join(temporary, "browser");
  gh("run", "download", String(browser.runId), "--repo", repository, "--name", `browser-evidence-${sha}`, "--dir", browserDirectory);
  const browserReport = JSON.parse(await readFile(path.join(browserDirectory, "browser-quality-timing.json"), "utf8"));
  assertBrowserArtifact(browserReport, { sha, artifactSha256: manifest.artifactSetSha256, baseSha: process.env.RELEASE_BASE_SHA, modes: {
    simulationExperienceMode: process.env.SIMULATION_EXPERIENCE_MODE,
    simulationAiMode: process.env.SIMULATION_AI_MODE,
    travelAtlasMode: process.env.TRAVEL_ATLAS_MODE,
  } });
  // Never overwrite a different local candidate. Retain it for recovery.
  try {
    await access("dist");
    await rename("dist", `.wrangler/previous-dist-${Date.now()}`);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await cp(path.join(temporary, "dist"), "dist", { recursive: true, errorOnExist: true });
  await rm(temporary, { recursive: true });
  console.log(`Downloaded verified build ${manifest.artifactSetSha256}; previous dist retained when present.`);
  const environmentNames = { validate: "RELEASE_VALIDATION_URL", gitleaks: "RELEASE_GITLEAKS_URL", codeql: "RELEASE_CODEQL_URL", browser: "RELEASE_BROWSER_URL" };
  const env = { ...process.env, RELEASE_VALIDATED_SHA: sha };
  for (const entry of evidence) env[environmentNames[entry.kind]] = entry.url;
  for (const command of ["validate:release", "release:plan"]) {
    const result = spawnSync("npm", ["run", command], { env, stdio: "inherit" });
    if (result.error || result.status !== 0) process.exit(result.status || 1);
  }
  const planBytes = await readFile("dist/release-plan.json", "utf8");
  const plan = JSON.parse(planBytes);
  const checkpoint = await verifyReleaseBuildCheckpoint(root);
  state.prepared = { artifactSha256: checkpoint.artifactSetSha256, planSha256: digest(planBytes), configurationSha256 };
  await writeFile(".wrangler/release-session.json", JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  console.log(`Guarded plan prepared for ${sha}. No hosted state changed. Next: guarded migration verification, upload, triggers and 0% staging; then the signed-in owner checkpoint. Promotion remains explicit.`);
  if (!plan) throw new Error("Release plan was not written.");
}
