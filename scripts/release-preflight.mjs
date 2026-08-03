import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPublicReleaseConfig,
  expectedPublicReleaseConfig,
} from "./lib/release-config-contract.mjs";
import { readVerifiedDeployableArtifactManifest } from "./lib/deployable-artifact-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(...arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for release preflight.`);
  return value;
}

const head = git("rev-parse", "HEAD");
const branch = git("branch", "--show-current");
const status = git("status", "--porcelain=v1", "--untracked-files=all");
if (status) {
  throw new Error("Release preflight requires a clean worktree, including no untracked files.");
}
if (branch !== "main" && process.env.ALLOW_NON_MAIN_RELEASE !== "1") {
  throw new Error("Release preflight requires main. Set ALLOW_NON_MAIN_RELEASE=1 only for a documented emergency release.");
}
const upstream = git("rev-parse", "@{upstream}");
if (upstream !== head) {
  throw new Error("The release commit must already be pushed to its configured upstream.");
}
const validatedSha = required("RELEASE_VALIDATED_SHA");
if (!/^[0-9a-f]{40}$/i.test(validatedSha) || validatedSha !== head) {
  throw new Error("RELEASE_VALIDATED_SHA must be the exact 40-character HEAD validated by GitHub Actions.");
}

const contentCheck = spawnSync(
  process.execPath,
  [path.join(root, "scripts/public-content-attestation.mjs"), "--check"],
  { cwd: root, encoding: "utf8" },
);
if (contentCheck.status !== 0) {
  throw new Error(contentCheck.stderr.trim() || "Public content attestation failed.");
}

const configPath = path.join(root, "dist/server/wrangler.public.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const bundle = JSON.parse(
  await readFile(
    path.join(root, "content/public/anish-content.public.v1.json"),
    "utf8",
  ),
);
assertPublicReleaseConfig(
  config,
  expectedPublicReleaseConfig(process.env, {
    head,
    contentVersion: bundle.contentVersion,
  }),
);
const { manifest: deployableArtifacts } =
  await readVerifiedDeployableArtifactManifest(root);

console.log(
  JSON.stringify(
    {
      status: "ready_for_version_upload",
      commitSha: head,
      branch,
      contentVersion: bundle.contentVersion,
      workerName: config.name,
      databaseName: config.d1_databases?.[0]?.database_name ?? null,
      deployableArtifactSetSha256: deployableArtifacts.artifactSetSha256,
    },
    null,
    2,
  ),
);
