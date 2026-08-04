import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRequiredValidationRuns,
  assertReleaseMarker,
  exactMigrationNames,
  exactVersionIds,
  githubRepositoryFromRemoteUrl,
  parseRemoteReleaseMarker,
  RELEASE_MARKER_QUERY,
  requireExactUploadedVersion,
  runGuardedMigration,
} from "./lib/release-contract.mjs";
import { readVerifiedDeployableArtifactManifest } from "./lib/deployable-artifact-contract.mjs";
import {
  RELEASE_BUILD_CHECKPOINT_PATH,
  verifyReleaseBuildCheckpoint,
} from "./lib/release-build-checkpoint.mjs";
import {
  assertTriggerDeploymentReceipt,
  createTriggerDeploymentReceipt,
  TRIGGER_RECEIPT_PATH,
} from "./lib/release-trigger-contract.mjs";
import { buildCopyDeck } from "./lib/copy-deck.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "dist/server/wrangler.public.json");
const planPath = path.join(root, "dist/release-plan.json");
const wranglerPath = path.join(root, "node_modules/wrangler/bin/wrangler.js");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function run(command, arguments_, options = {}) {
  const { stdoutOnly = false, ...spawnOptions } = options;
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...spawnOptions,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const diagnostic = [result.stderr, result.stdout]
      .filter((value) => typeof value === "string" && value.trim())
      .join("\n")
      .trim();
    throw new Error(
      `${path.basename(command)} ${arguments_.join(" ")} failed${diagnostic ? `:\n${diagnostic}` : "."}`,
    );
  }
  return stdoutOnly
    ? `${result.stdout ?? ""}`
    : `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function git(...arguments_) {
  return run("git", arguments_).trim();
}

function configuredGithubRepository() {
  const branch = git("branch", "--show-current");
  const remote = branch
    ? git("config", "--get", `branch.${branch}.remote`)
    : "";
  if (!remote || remote === ".") {
    throw new Error("The release branch must track a GitHub remote.");
  }
  return githubRepositoryFromRemoteUrl(git("remote", "get-url", "--push", remote));
}

function wrangler(...arguments_) {
  return run(process.execPath, [wranglerPath, ...arguments_]);
}

function wranglerJson(...arguments_) {
  return run(process.execPath, [wranglerPath, ...arguments_], {
    stdoutOnly: true,
  });
}

async function verifyPlan() {
  const head = git("rev-parse", "HEAD");
  if (git("status", "--porcelain=v1", "--untracked-files=all")) {
    throw new Error("A release command requires a clean worktree.");
  }
  if (git("rev-parse", "@{upstream}") !== head) {
    throw new Error("HEAD must be pushed to its configured upstream.");
  }
  if (process.env.RELEASE_VALIDATED_SHA?.trim() !== head) {
    throw new Error("RELEASE_VALIDATED_SHA must equal HEAD.");
  }

  const [
    planBytes,
    attestationBytes,
    configBytes,
    deployableArtifactResult,
    releaseBuildCheckpoint,
    releaseBuildCheckpointBytes,
  ] = await Promise.all([
    readFile(planPath),
    readFile(path.join(root, "content/public/anish-content.public.v1.attestation.json")),
    readFile(configPath),
    readVerifiedDeployableArtifactManifest(root),
    verifyReleaseBuildCheckpoint(root),
    readFile(path.join(root, RELEASE_BUILD_CHECKPOINT_PATH)),
  ]);
  const plan = JSON.parse(planBytes.toString("utf8"));
  const attestation = JSON.parse(attestationBytes.toString("utf8"));
  const config = JSON.parse(configBytes.toString("utf8"));
  const { copyVersion } = await buildCopyDeck(root);
  if (
    plan.schemaVersion !== "1.2" ||
    plan.commitSha !== head ||
    plan.contentVersion !== attestation.contentVersion ||
    plan.copyVersion !== copyVersion ||
    plan.checksums?.publicContentAttestationSha256 !== sha256(attestationBytes) ||
    plan.checksums?.preparedWorkerConfigSha256 !== sha256(configBytes) ||
    plan.checksums?.deployableArtifactManifestSha256 !==
      sha256(deployableArtifactResult.bytes) ||
    plan.deployableArtifacts?.artifactSetSha256 !==
      deployableArtifactResult.manifest.artifactSetSha256 ||
    plan.deployableArtifacts?.fileCount !==
      deployableArtifactResult.manifest.fileCount ||
    plan.deployableArtifacts?.totalBytes !==
      deployableArtifactResult.manifest.totalBytes ||
    plan.releaseBuildCheckpoint?.sha256 !==
      sha256(releaseBuildCheckpointBytes) ||
    plan.releaseBuildCheckpoint?.artifactSetSha256 !==
      releaseBuildCheckpoint.artifactSetSha256 ||
    plan.releaseBuildCheckpoint?.deployableManifestSha256 !==
      releaseBuildCheckpoint.deployableManifestSha256 ||
    plan.checksums?.releaseBuildCheckpointSha256 !==
      sha256(releaseBuildCheckpointBytes) ||
    releaseBuildCheckpoint.artifactSetSha256 !==
      deployableArtifactResult.manifest.artifactSetSha256 ||
    releaseBuildCheckpoint.deployableManifestSha256 !==
      sha256(deployableArtifactResult.bytes) ||
    config.vars?.RELEASE_SHA !== head ||
    config.vars?.CONTENT_VERSION !== plan.contentVersion ||
    config.vars?.PLAY_EXPERIENCE_MODE !== plan.playExperienceMode ||
    !["classic", "my-room-2001"].includes(plan.playExperienceMode) ||
    !["compatible", "predeploy_bootstrap_required"].includes(
      plan.publicationCheckpoint?.status,
    )
  ) {
    throw new Error("The ignored release plan is stale or does not match this build.");
  }
  const repository = configuredGithubRepository();
  if (plan.repository !== repository) {
    throw new Error("The release plan does not match the configured upstream repository.");
  }
  assertRequiredValidationRuns(plan.validationRuns, head, repository);
  if (!Array.isArray(plan.d1?.migrations)) {
    throw new Error("The release plan has no migration evidence.");
  }
  for (const migration of plan.d1.migrations) {
    if (
      !migration ||
      typeof migration.name !== "string" ||
      !/^[a-f0-9]{64}$/.test(migration.sha256)
    ) {
      throw new Error("The release plan has malformed migration evidence.");
    }
    const bytes = await readFile(path.join(root, "drizzle", migration.name));
    if (sha256(bytes) !== migration.sha256) {
      throw new Error(`Migration ${migration.name} changed after release planning.`);
    }
  }

  run(process.execPath, [path.join(root, "scripts/release-preflight.mjs")], {
    stdio: "inherit",
  });
  return { head, plan, config, configBytes };
}

async function requireCurrentTriggerReceipt({ head, plan, config, configBytes }) {
  let receipt;
  try {
    receipt = JSON.parse(
      await readFile(path.join(root, TRIGGER_RECEIPT_PATH), "utf8"),
    );
  } catch {
    throw new Error(
      "Apply the exact non-versioned trigger configuration with npm run cloudflare:triggers before staging or deployment.",
    );
  }
  return assertTriggerDeploymentReceipt(receipt, {
    head,
    configSha256: sha256(configBytes),
    config,
    notBefore: plan.preparedAt,
  });
}

async function pendingMigrations() {
  const output = wrangler(
    "d1",
    "migrations",
    "list",
    "DB",
    "--remote",
    "--config",
    configPath,
  );
  return exactMigrationNames(output);
}

function remoteReleaseMarker() {
  return parseRemoteReleaseMarker(
    wranglerJson(
      "d1",
      "execute",
      "DB",
      "--remote",
      "--command",
      RELEASE_MARKER_QUERY,
      "--json",
      "--config",
      configPath,
    ),
  );
}

const action = process.argv[2];
if (!new Set(["migrate", "upload", "triggers", "stage", "deploy"]).has(action)) {
  throw new Error(
    "Use release-command.mjs migrate, upload, triggers, stage, or deploy.",
  );
}

const { head, plan, config, configBytes } = await verifyPlan();
const plannedMigrations = plan.d1.migrations.map((migration) => migration.name);

if (action === "migrate") {
  const result = await runGuardedMigration({
    planned: plannedMigrations,
    listPending: pendingMigrations,
    apply: async () => {
      process.stdout.write(
        wrangler(
          "d1",
          "migrations",
          "apply",
          "DB",
          "--remote",
          "--config",
          configPath,
        ),
      );
    },
  });
  if (!result.applied) {
    console.log("No remote migrations are planned; no mutation performed.");
  }
} else if (action === "upload") {
  const pending = await pendingMigrations();
  if (pending.length > 0) {
    throw new Error(`Apply the planned migrations before upload: ${pending.join(", ")}.`);
  }
  process.stdout.write(
    wrangler(
      "versions",
      "upload",
      "--config",
      configPath,
      "--message",
      head,
      "--tag",
      head,
      "--strict",
    ),
  );
} else {
  const pending = await pendingMigrations();
  if (pending.length > 0) {
    throw new Error(`Apply the planned migrations before release: ${pending.join(", ")}.`);
  }
  const version = process.env.RELEASE_WORKER_VERSION?.trim();
  if (!version || !/^[A-Za-z0-9_-]{8,160}$/.test(version)) {
    throw new Error("RELEASE_WORKER_VERSION must be the uploaded Worker version ID.");
  }
  if (version === plan.previousWorkerVersion) {
    throw new Error("The new Worker version cannot equal the prior version.");
  }
  const available = exactVersionIds(
    wrangler("versions", "list", "--config", configPath),
  );
  requireExactUploadedVersion(available.join("\n"), version);
  if (action === "triggers") {
    process.stdout.write(
      wrangler("triggers", "deploy", "--config", configPath),
    );
    const receipt = createTriggerDeploymentReceipt({
      head,
      configSha256: sha256(configBytes),
      config,
      appliedAt: new Date().toISOString(),
    });
    await writeFile(
      path.join(root, TRIGGER_RECEIPT_PATH),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log(
      "Recorded the exact successful non-versioned trigger reconciliation for this release.",
    );
  } else if (action === "stage") {
    await requireCurrentTriggerReceipt({
      head,
      plan,
      config,
      configBytes,
    });
    const previous = plan.previousWorkerVersion;
    if (!previous || !available.includes(previous)) {
      throw new Error("The prior Worker version is unavailable for zero-traffic staging.");
    }
    process.stdout.write(
      wrangler(
        "versions",
        "deploy",
        `${version}@0%`,
        `${previous}@100%`,
        "--config",
        configPath,
        "--yes",
      ),
    );
  } else {
    await requireCurrentTriggerReceipt({
      head,
      plan,
      config,
      configBytes,
    });
    assertReleaseMarker(remoteReleaseMarker(), {
      head,
      contentVersion: plan.contentVersion,
      preparedAt: plan.preparedAt,
    });
    process.stdout.write(
      wrangler(
        "versions",
        "deploy",
        `${version}@100%`,
        "--config",
        configPath,
        "--yes",
      ),
    );
  }
}
