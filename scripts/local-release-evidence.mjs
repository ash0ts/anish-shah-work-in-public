import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExactLocalReleaseState,
  buildOwnerLocalEvidenceReceipt,
  createLocalReleaseProcessGroupTerminator,
  LOCAL_RELEASE_FORCE_EXIT_WAIT_MS,
  LOCAL_RELEASE_EVIDENCE_COMMANDS,
  LOCAL_RELEASE_EVIDENCE_NAMES,
  LOCAL_RELEASE_EVIDENCE_PATH,
  LOCAL_RELEASE_TERMINATION_GRACE_MS,
  localReleaseControlTimeout,
  localReleaseGateBudget,
  localReleaseGateTimeoutError,
  localReleaseOverallDeadline,
  localReleaseProcessGroupExists,
  removeOwnerLocalEvidenceReceipt,
  sha256,
  writeOwnerLocalEvidenceReceipt,
} from "./lib/local-release-evidence.mjs";
import {
  readVerifiedDeployableArtifactManifest,
} from "./lib/deployable-artifact-contract.mjs";
import {
  RELEASE_BUILD_CHECKPOINT_PATH,
  verifyReleaseBuildCheckpoint,
} from "./lib/release-build-checkpoint.mjs";
import {
  CANONICAL_GITHUB_REPOSITORY,
  githubRepositoryFromRemoteUrl,
  OWNER_LOCAL_TOOL_VERSIONS,
  RELEASE_EVIDENCE_MODES,
  selectedReleaseEvidenceMode,
} from "./lib/release-contract.mjs";
import { verifyOwnerLocalCodeqlEvidence } from "./lib/owner-local-codeql.mjs";
import { verifyOwnerLocalRemoteMain } from "./lib/owner-local-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INTERRUPT_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);

function boundedSyncOptions(overallDeadlineMs) {
  return {
    cwd: root,
    encoding: "utf8",
    timeout: localReleaseControlTimeout({
      nowMs: Date.now(),
      overallDeadlineMs,
    }),
    killSignal: "SIGTERM",
    maxBuffer: 4 * 1024 * 1024,
  };
}

function syncCommandError(result, label) {
  if (result.error?.code === "ETIMEDOUT") {
    return new Error(`${label} exceeded its bounded control-command deadline.`);
  }
  return new Error(
    `${label} failed: ${result.stderr?.trim() || result.error?.message || "unknown error"}`,
  );
}

function git(overallDeadlineMs, ...arguments_) {
  const result = spawnSync("git", arguments_, {
    ...boundedSyncOptions(overallDeadlineMs),
  });
  if (result.error || result.status !== 0) {
    throw syncCommandError(result, `git ${arguments_.join(" ")}`);
  }
  return result.stdout.trim();
}

function exactReleaseState(overallDeadlineMs) {
  const head = git(overallDeadlineMs, "rev-parse", "HEAD").toLowerCase();
  const expectedSha = process.env.RELEASE_VALIDATED_SHA?.trim().toLowerCase();
  const status = git(
    overallDeadlineMs,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  );
  const branch = git(overallDeadlineMs, "branch", "--show-current");
  const upstreamRef = git(
    overallDeadlineMs,
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  );
  let upstream;
  try {
    upstream = git(overallDeadlineMs, "rev-parse", "@{upstream}").toLowerCase();
  } catch {
    throw new Error(
      "Owner-local release evidence requires a configured pushed upstream.",
    );
  }
  const repository = githubRepositoryFromRemoteUrl(
    git(overallDeadlineMs, "remote", "get-url", "--push", "origin"),
  );
  const state = assertExactLocalReleaseState({
    head,
    expectedSha,
    worktreeStatus: status,
    branch,
    upstreamRef,
    upstream,
    repository,
  });
  verifyOwnerLocalRemoteMain({
    root,
    head: state.head,
    timeoutMs: localReleaseControlTimeout({
      nowMs: Date.now(),
      overallDeadlineMs,
    }),
  });
  return state;
}

function exactCommandVersion(
  command,
  arguments_,
  pattern,
  label,
  overallDeadlineMs,
) {
  const result = spawnSync(command, arguments_, {
    ...boundedSyncOptions(overallDeadlineMs),
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error || result.status !== 0) {
    if (result.error?.code === "ETIMEDOUT") {
      throw new Error(`${label} version check exceeded its bounded deadline.`);
    }
    throw new Error(`${label} is unavailable for owner-local release evidence.`);
  }
  const value = result.stdout.trim().match(pattern)?.[1];
  if (!value) throw new Error(`${label} returned an unexpected version.`);
  return value;
}

async function toolVersions(overallDeadlineMs) {
  const playwrightPackage = JSON.parse(
    await readFile(
      path.join(root, "node_modules/@playwright/test/package.json"),
      "utf8",
    ),
  );
  const tools = {
    node: process.version,
    npm: exactCommandVersion(
      "npm",
      ["--version"],
      /^(\S+)$/u,
      "npm",
      overallDeadlineMs,
    ),
    gitleaks: exactCommandVersion(
      "gitleaks",
      ["version"],
      /^(\S+)$/u,
      "Gitleaks",
      overallDeadlineMs,
    ),
    playwright: String(playwrightPackage.version ?? ""),
  };
  const expectedNode = (await readFile(path.join(root, ".node-version"), "utf8"))
    .trim();
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (tools.node !== `v${expectedNode}`) {
    throw new Error(`Node must be v${expectedNode} for owner-local evidence.`);
  }
  if (tools.npm !== packageJson.packageManager?.replace(/^npm@/u, "")) {
    throw new Error(
      `npm must be ${packageJson.packageManager?.replace(/^npm@/u, "")} for owner-local evidence.`,
    );
  }
  if (tools.playwright !== packageJson.devDependencies?.["@playwright/test"]) {
    throw new Error("Playwright does not match the pinned repository version.");
  }
  if (JSON.stringify(tools) !== JSON.stringify(OWNER_LOCAL_TOOL_VERSIONS)) {
    throw new Error("The owner-local toolchain does not match the release contract.");
  }
  return tools;
}

function outputIdentity(stdoutSha256, stderrSha256) {
  return sha256(
    `stdout-sha256\0${stdoutSha256}\nstderr-sha256\0${stderrSha256}\n`,
  );
}

async function runGate(kind, command, arguments_, overallDeadlineMs) {
  exactReleaseState(overallDeadlineMs);
  const startedAtMs = Date.now();
  const budget = localReleaseGateBudget({
    kind,
    startedAtMs,
    overallDeadlineMs,
  });
  const startedAt = new Date().toISOString();
  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");
  const child = spawn(command, arguments_, {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.on("data", (chunk) => {
    stdoutHash.update(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderrHash.update(chunk);
    process.stderr.write(chunk);
  });
  const exitCode = await new Promise((resolve, reject) => {
    let settled = false;
    let terminationReason;
    let terminationError;
    let hardStopTimer;
    const listeners = new Map();
    const terminator = Number.isSafeInteger(child.pid)
      ? createLocalReleaseProcessGroupTerminator({
          pid: child.pid,
          onSignalError(error, signal) {
            terminationError ??= new Error(
              `Could not send ${signal} to the ${LOCAL_RELEASE_EVIDENCE_NAMES[kind]} process group: ${error.message}`,
            );
          },
        })
      : null;

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(hardStopTimer);
      terminator?.cancel();
      for (const [signal, listener] of listeners) {
        process.removeListener(signal, listener);
      }
    };
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(code);
    };
    const reasonError = () => {
      if (terminationReason?.type === "timeout") {
        return localReleaseGateTimeoutError(kind, budget);
      }
      if (terminationReason?.type === "interrupt") {
        return new Error(
          `${LOCAL_RELEASE_EVIDENCE_NAMES[kind]} was interrupted by ${terminationReason.signal}.`,
        );
      }
      return terminationError;
    };
    const beginTermination = (reason) => {
      if (terminationReason || settled) return;
      terminationReason = reason;
      if (terminator) {
        terminator.begin();
      } else {
        child.kill("SIGTERM");
      }
      hardStopTimer = setTimeout(() => {
        // SIGKILL was sent by the terminator after the grace period. Stop
        // waiting even if the platform fails to deliver a close event.
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish(reasonError() ?? new Error("Owner-local gate termination failed."));
      }, LOCAL_RELEASE_TERMINATION_GRACE_MS + LOCAL_RELEASE_FORCE_EXIT_WAIT_MS);
    };

    const timeoutTimer = setTimeout(() => {
      beginTermination({ type: "timeout" });
    }, budget.timeoutMs);
    for (const signal of INTERRUPT_SIGNALS) {
      const listener = () => beginTermination({ type: "interrupt", signal });
      listeners.set(signal, listener);
      process.once(signal, listener);
    }

    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (terminationReason) {
        // The npm/gitleaks leader can exit before one of its descendants. Keep
        // the escalation timer alive until the whole detached group is gone;
        // otherwise a timed-out browser/server process could survive the gate.
        try {
          if (
            !Number.isSafeInteger(child.pid) ||
            !localReleaseProcessGroupExists({ pid: child.pid })
          ) {
            finish(reasonError() ?? terminationError);
          }
        } catch (error) {
          terminationError ??= error;
        }
      } else if (signal) {
        finish(
          new Error(`${LOCAL_RELEASE_EVIDENCE_NAMES[kind]} stopped by ${signal}.`),
        );
      } else {
        finish(null, code ?? 1);
      }
    });
  });
  const completedAt = new Date().toISOString();
  const stdoutSha256 = stdoutHash.digest("hex");
  const stderrSha256 = stderrHash.digest("hex");
  if (exitCode !== 0) {
    throw new Error(
      `${LOCAL_RELEASE_EVIDENCE_NAMES[kind]} failed with exit code ${exitCode}.`,
    );
  }
  return {
    kind,
    name: LOCAL_RELEASE_EVIDENCE_NAMES[kind],
    command: LOCAL_RELEASE_EVIDENCE_COMMANDS[kind],
    status: "pass",
    startedAt,
    completedAt,
    exitCode,
    outputSha256: outputIdentity(stdoutSha256, stderrSha256),
  };
}

async function artifactIdentity(overallDeadlineMs) {
  localReleaseControlTimeout({ nowMs: Date.now(), overallDeadlineMs });
  const [{ bytes: manifestBytes, manifest }, checkpoint, checkpointBytes] =
    await Promise.all([
      readVerifiedDeployableArtifactManifest(root),
      verifyReleaseBuildCheckpoint(root),
      readFile(path.join(root, RELEASE_BUILD_CHECKPOINT_PATH)),
    ]);
  localReleaseControlTimeout({ nowMs: Date.now(), overallDeadlineMs });
  if (checkpoint.artifactSetSha256 !== manifest.artifactSetSha256) {
    throw new Error("The release checkpoint and deployable manifest disagree.");
  }
  return {
    artifactSetSha256: manifest.artifactSetSha256,
    deployableManifestSha256: sha256(manifestBytes),
    releaseBuildCheckpointSha256: sha256(checkpointBytes),
  };
}

async function run() {
  if (process.argv.length !== 3 || process.argv[2] !== "run") {
    throw new Error("Use local-release-evidence.mjs run.");
  }
  if (selectedReleaseEvidenceMode() !== RELEASE_EVIDENCE_MODES.ownerLocal) {
    throw new Error(
      "release:evidence:local requires the explicitly confirmed owner-local evidence mode.",
    );
  }
  const overallDeadlineMs = localReleaseOverallDeadline(Date.now());
  await removeOwnerLocalEvidenceReceipt(root);
  const initialState = exactReleaseState(overallDeadlineMs);
  if (initialState.repository !== CANONICAL_GITHUB_REPOSITORY) {
    throw new Error("Owner-local evidence requires the canonical repository.");
  }
  verifyOwnerLocalCodeqlEvidence({
    root,
    ...initialState,
    url: process.env.RELEASE_CODEQL_URL?.trim(),
    runnerLabel: process.env.RELEASE_CODEQL_RUNNER_LABEL?.trim(),
  });
  localReleaseControlTimeout({ nowMs: Date.now(), overallDeadlineMs });
  const tools = await toolVersions(overallDeadlineMs);
  const validate = await runGate("validate", "npm", [
    "run",
    "validate:release:local",
  ], overallDeadlineMs);
  const artifact = await artifactIdentity(overallDeadlineMs);
  validate.artifactSetSha256 = artifact.artifactSetSha256;

  await artifactIdentity(overallDeadlineMs);
  const gitleaks = await runGate("gitleaks", "gitleaks", [
    "git",
    "--redact",
    "--no-banner",
    ".",
  ], overallDeadlineMs);
  gitleaks.artifactSetSha256 = (
    await artifactIdentity(overallDeadlineMs)
  ).artifactSetSha256;

  const browser = await runGate("browser", "npm", [
    "run",
    "browser:release:existing",
  ], overallDeadlineMs);
  browser.artifactSetSha256 = (
    await artifactIdentity(overallDeadlineMs)
  ).artifactSetSha256;

  const finalState = exactReleaseState(overallDeadlineMs);
  if (JSON.stringify(finalState) !== JSON.stringify(initialState)) {
    throw new Error("The release source identity changed during local validation.");
  }
  const finalArtifact = await artifactIdentity(overallDeadlineMs);
  if (JSON.stringify(finalArtifact) !== JSON.stringify(artifact)) {
    throw new Error("The deployable release bytes changed between local gates.");
  }
  const receipt = buildOwnerLocalEvidenceReceipt({
    repository: initialState.repository,
    ref: initialState.ref,
    commitSha: initialState.head,
    tools,
    artifact,
    results: { validate, gitleaks, browser },
  });
  const written = await writeOwnerLocalEvidenceReceipt(root, receipt);
  console.log(
    `Owner-local release evidence passed for ${initialState.head}.\n` +
      `Artifact: ${artifact.artifactSetSha256}\n` +
      `Receipt: ${LOCAL_RELEASE_EVIDENCE_PATH} (${written.sha256})\n` +
      "CodeQL remains a separate exact-SHA workflow_dispatch run on the disposable AMD64 owner runner.",
  );
}

await run().catch(async (error) => {
  await removeOwnerLocalEvidenceReceipt(root).catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
