import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assertOwnerLocalEvidenceReceipt } from "../scripts/lib/release-contract.mjs";
import { ownerLocalCodeqlEvidenceFromResponses } from "../scripts/lib/owner-local-codeql.mjs";
import { assertOwnerLocalRemoteMainResponse } from "../scripts/lib/owner-local-source.mjs";

import {
  assertExactLocalReleaseState,
  buildOwnerLocalEvidenceReceipt,
  canonicalPayloadSha256,
  createLocalReleaseProcessGroupTerminator,
  exactLocalReleaseRef,
  LOCAL_RELEASE_CONTROL_TIMEOUT_MS,
  LOCAL_RELEASE_EVIDENCE_COMMANDS,
  LOCAL_RELEASE_EVIDENCE_PATH,
  LOCAL_RELEASE_GATE_TIMEOUT_MS,
  LOCAL_RELEASE_OVERALL_TIMEOUT_MS,
  LOCAL_RELEASE_TERMINATION_GRACE_MS,
  localReleaseControlTimeout,
  localReleaseGateBudget,
  localReleaseGateTimeoutError,
  localReleaseOverallDeadline,
  localReleaseProcessGroupExists,
  localReleaseProcessGroupTarget,
  removeOwnerLocalEvidenceReceipt,
  writeOwnerLocalEvidenceReceipt,
} from "../scripts/lib/local-release-evidence.mjs";

const digest = (character) => character.repeat(64);

function result(kind, name, command, artifactSetSha256, minute) {
  return {
    kind,
    name,
    command,
    status: "pass",
    startedAt: `2026-08-24T12:0${minute}:00.000Z`,
    completedAt: `2026-08-24T12:0${minute}:30.000Z`,
    exitCode: 0,
    outputSha256: digest(String(minute + 1)),
    artifactSetSha256,
  };
}

function validInput() {
  const artifactSetSha256 = digest("a");
  return {
    repository: "ash0ts/anish-shah-work-in-public",
    ref: "refs/heads/main",
    commitSha: "b".repeat(40),
    tools: {
      node: "v24.18.0",
      npm: "11.6.2",
      gitleaks: "8.30.1",
      playwright: "1.62.1",
    },
    artifact: {
      artifactSetSha256,
      deployableManifestSha256: digest("c"),
      releaseBuildCheckpointSha256: digest("d"),
    },
    results: {
      validate: result(
        "validate",
        "Validate",
        LOCAL_RELEASE_EVIDENCE_COMMANDS.validate,
        artifactSetSha256,
        1,
      ),
      gitleaks: result(
        "gitleaks",
        "Gitleaks",
        LOCAL_RELEASE_EVIDENCE_COMMANDS.gitleaks,
        artifactSetSha256,
        2,
      ),
      browser: result(
        "browser",
        "Browser Quality",
        LOCAL_RELEASE_EVIDENCE_COMMANDS.browser,
        artifactSetSha256,
        3,
      ),
    },
  };
}

test("owner-local receipt binds three exact commands to one artifact", () => {
  const receipt = buildOwnerLocalEvidenceReceipt(validInput());
  assert.equal(receipt.schemaVersion, "1.0");
  assert.equal(receipt.mode, "owner-local");
  assert.equal(receipt.completedAt, "2026-08-24T12:03:30.000Z");
  assert.equal(
    receipt.payloadSha256,
    canonicalPayloadSha256(
      Object.fromEntries(
        Object.entries(receipt).filter(([key]) => key !== "payloadSha256"),
      ),
    ),
  );
  assert.deepEqual(Object.keys(receipt.results), [
    "validate",
    "gitleaks",
    "browser",
  ]);
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  assert.doesNotThrow(() =>
    assertOwnerLocalEvidenceReceipt(receipt, receiptBytes, {
      head: receipt.commitSha,
      repository: receipt.repository,
      ref: receipt.ref,
      artifact: receipt.artifact,
      notBefore: "2026-08-24T12:00:00.000Z",
      notAfter: "2026-08-24T12:04:00.000Z",
    }),
  );
});

test("owner-local deadlines match workflow budgets and share one overall deadline", () => {
  assert.deepEqual(LOCAL_RELEASE_GATE_TIMEOUT_MS, {
    validate: 35 * 60_000,
    gitleaks: 10 * 60_000,
    browser: 20 * 60_000,
  });
  assert.equal(LOCAL_RELEASE_OVERALL_TIMEOUT_MS, 70 * 60_000);
  const startedAtMs = 1_000;
  const overallDeadlineMs = localReleaseOverallDeadline(startedAtMs);
  assert.deepEqual(
    localReleaseGateBudget({
      kind: "validate",
      startedAtMs,
      overallDeadlineMs,
    }),
    {
      deadlineMs: startedAtMs + 35 * 60_000,
      timeoutMs: 35 * 60_000,
      limitedBy: "gate",
    },
  );
  const finalFiveSeconds = localReleaseGateBudget({
    kind: "browser",
    startedAtMs: overallDeadlineMs - 5_000,
    overallDeadlineMs,
  });
  assert.deepEqual(finalFiveSeconds, {
    deadlineMs: overallDeadlineMs,
    timeoutMs: 5_000,
    limitedBy: "overall",
  });
  assert.match(
    localReleaseGateTimeoutError("browser", finalFiveSeconds).message,
    /overall deadline during Browser Quality/u,
  );
  assert.throws(
    () =>
      localReleaseGateBudget({
        kind: "gitleaks",
        startedAtMs: overallDeadlineMs,
        overallDeadlineMs,
      }),
    /overall deadline before Gitleaks/u,
  );
});

test("owner-local control commands are bounded by both command and overall time", () => {
  assert.equal(
    localReleaseControlTimeout({ nowMs: 1_000, overallDeadlineMs: 61_000 }),
    LOCAL_RELEASE_CONTROL_TIMEOUT_MS,
  );
  assert.equal(
    localReleaseControlTimeout({ nowMs: 59_500, overallDeadlineMs: 61_000 }),
    1_500,
  );
  assert.throws(
    () =>
      localReleaseControlTimeout({
        nowMs: 61_000,
        overallDeadlineMs: 61_000,
      }),
    /exceeded its overall deadline/u,
  );
});

test("owner-local termination targets the detached process group and escalates", () => {
  const signals = [];
  const scheduled = [];
  const cancelled = [];
  let unrefCount = 0;
  const timer = {
    unref() {
      unrefCount += 1;
    },
  };
  const terminator = createLocalReleaseProcessGroupTerminator({
    pid: 4_321,
    platform: "linux",
    signalProcess(target, signal) {
      signals.push([target, signal]);
    },
    schedule(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return timer;
    },
    cancelSchedule(value) {
      cancelled.push(value);
    },
  });

  assert.equal(localReleaseProcessGroupTarget(4_321, "darwin"), -4_321);
  assert.throws(
    () => localReleaseProcessGroupTarget(4_321, "win32"),
    /requires POSIX process-group termination/u,
  );
  assert.equal(terminator.begin(), true);
  assert.equal(terminator.begin(), false, "termination must be idempotent");
  assert.deepEqual(signals, [[-4_321, "SIGTERM"]]);
  assert.equal(scheduled[0].delayMs, LOCAL_RELEASE_TERMINATION_GRACE_MS);
  assert.equal(unrefCount, 1);
  scheduled[0].callback();
  assert.deepEqual(signals, [
    [-4_321, "SIGTERM"],
    [-4_321, "SIGKILL"],
  ]);
  terminator.cancel();
  assert.deepEqual(cancelled, []);
});

test("owner-local process-group probes distinguish gone descendants", () => {
  assert.equal(
    localReleaseProcessGroupExists({
      pid: 4321,
      platform: "linux",
      signalProcess(target, signal) {
        assert.equal(target, -4321);
        assert.equal(signal, 0);
      },
    }),
    true,
  );
  assert.equal(
    localReleaseProcessGroupExists({
      pid: 4321,
      platform: "linux",
      signalProcess() {
        const error = new Error("gone");
        error.code = "ESRCH";
        throw error;
      },
    }),
    false,
  );
});

test("owner-local termination can cancel escalation without spawning a process", () => {
  const signals = [];
  const cancelled = [];
  const timer = { unref() {} };
  const terminator = createLocalReleaseProcessGroupTerminator({
    pid: 99,
    platform: "linux",
    signalProcess(target, signal) {
      signals.push([target, signal]);
    },
    schedule() {
      return timer;
    },
    cancelSchedule(value) {
      cancelled.push(value);
    },
  });
  terminator.begin();
  terminator.cancel();
  assert.deepEqual(signals, [[-99, "SIGTERM"]]);
  assert.deepEqual(cancelled, [timer]);
});

test("owner-local receipt rejects failed, substituted, or artifact-drifted gates", () => {
  const failed = validInput();
  failed.results.gitleaks.status = "fail";
  assert.throws(
    () => buildOwnerLocalEvidenceReceipt(failed),
    /did not pass the exact owner-local command/,
  );

  const substituted = validInput();
  substituted.results.browser.command = "npm run browser:public:existing";
  assert.throws(
    () => buildOwnerLocalEvidenceReceipt(substituted),
    /did not pass the exact owner-local command/,
  );

  const drifted = validInput();
  drifted.results.browser.artifactSetSha256 = digest("e");
  assert.throws(
    () => buildOwnerLocalEvidenceReceipt(drifted),
    /against the release artifact/,
  );
});

test("owner-local receipt requires the pinned toolchain", () => {
  const input = validInput();
  input.tools.gitleaks = "8.29.0";
  assert.throws(
    () => buildOwnerLocalEvidenceReceipt(input),
    /incomplete tool versions/,
  );
});

test("owner-local receipt rejects extra results and untrusted refs", () => {
  const extra = validInput();
  extra.results.codeql = { status: "pass" };
  assert.throws(
    () => buildOwnerLocalEvidenceReceipt(extra),
    /requires exactly Validate, Gitleaks, and Browser Quality/,
  );
  assert.equal(exactLocalReleaseRef("main"), "refs/heads/main");
  assert.throws(
    () => exactLocalReleaseRef("release/2.3.0"),
    /requires main/,
  );
});

test("owner-local source state refuses wrong SHA, dirty work, and unpushed HEAD", () => {
  const head = "b".repeat(40);
  const state = {
    head,
    expectedSha: head,
    worktreeStatus: "",
    branch: "main",
    upstreamRef: "origin/main",
    upstream: head,
    repository: "ash0ts/anish-shah-work-in-public",
  };
  assert.deepEqual(assertExactLocalReleaseState(state), {
    head,
    ref: "refs/heads/main",
    repository: state.repository,
  });
  assert.throws(
    () => assertExactLocalReleaseState({ ...state, expectedSha: "c".repeat(40) }),
    /exact 40-character local HEAD/,
  );
  assert.throws(
    () => assertExactLocalReleaseState({ ...state, worktreeStatus: " M app/page.tsx" }),
    /clean exact origin\/main/,
  );
  assert.throws(
    () => assertExactLocalReleaseState({ ...state, upstream: "c".repeat(40) }),
    /exact origin\/main/,
  );
  assert.throws(
    () => assertExactLocalReleaseState({ ...state, upstreamRef: "fork/main" }),
    /exact origin\/main/,
  );
  assert.throws(
    () => assertExactLocalReleaseState({ ...state, repository: "example/repo" }),
    /canonical repository/,
  );
});

test("owner-local source requires the exact live canonical origin/main head", () => {
  const head = "b".repeat(40);
  assert.deepEqual(
    assertOwnerLocalRemoteMainResponse(`${head}\trefs/heads/main\n`, head),
    { head, ref: "refs/heads/main" },
  );
  for (const output of [
    "",
    `${"c".repeat(40)}\trefs/heads/main\n`,
    `${head}\trefs/heads/release/2.3.0\n`,
    `${head}\trefs/heads/main\n${head}\trefs/heads/main\n`,
  ]) {
    assert.throws(
      () => assertOwnerLocalRemoteMainResponse(output, head),
      /live canonical origin\/main head/u,
    );
  }
});

test("owner-local CodeQL binds the active workflow to the disposable x64 runner", () => {
  const head = "b".repeat(40);
  const runnerLabel = "anish-release-a1b2c3d4e5f6";
  const evidence = ownerLocalCodeqlEvidenceFromResponses({
    head,
    repository: "ash0ts/anish-shah-work-in-public",
    url: "https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/123",
    runnerLabel,
    run: {
      headSha: head,
      headBranch: "main",
      conclusion: "success",
      url: "https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/123",
      name: "CodeQL",
      event: "workflow_dispatch",
      workflowDatabaseId: 44,
    },
    workflow: {
      id: 44,
      name: "CodeQL",
      path: ".github/workflows/codeql.yml",
      state: "active",
    },
    jobs: {
      jobs: [{
        id: 55,
        name: "analyze",
        status: "completed",
        conclusion: "success",
        labels: ["self-hosted", "Linux", "X64", runnerLabel],
      }],
    },
  });
  assert.deepEqual(evidence.runner, {
    jobDatabaseId: 55,
    jobName: "analyze",
    jitLabel: runnerLabel,
    labels: [runnerLabel, "linux", "self-hosted", "x64"],
  });

  for (const jobs of [
    { jobs: [{ id: 55, name: "analyze", status: "completed", conclusion: "success", labels: ["ubuntu-latest"] }] },
    { jobs: [{ id: 55, name: "analyze", status: "completed", conclusion: "failure", labels: ["self-hosted", "linux", "x64", runnerLabel] }] },
  ]) {
    assert.throws(
      () => ownerLocalCodeqlEvidenceFromResponses({
        head,
        repository: "ash0ts/anish-shah-work-in-public",
        url: "https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/123",
        runnerLabel,
        run: {
          headSha: head,
          headBranch: "main",
          conclusion: "success",
          url: "https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/123",
          name: "CodeQL",
          event: "workflow_dispatch",
          workflowDatabaseId: 44,
        },
        workflow: { id: 44, name: "CodeQL", path: ".github/workflows/codeql.yml", state: "active" },
        jobs,
      }),
      /disposable self-hosted Linux x64 runner/,
    );
  }
});

test("owner-local CodeQL rejects evidence dispatched from another ref", () => {
  const head = "b".repeat(40);
  const runnerLabel = "anish-release-a1b2c3d4e5f6";
  assert.throws(
    () => ownerLocalCodeqlEvidenceFromResponses({
      head,
      repository: "ash0ts/anish-shah-work-in-public",
      url: "https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/123",
      runnerLabel,
      run: {
        headSha: head,
        headBranch: "release/2.3.0",
        conclusion: "success",
        url: "https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/123",
        name: "CodeQL",
        event: "workflow_dispatch",
        workflowDatabaseId: 44,
      },
      workflow: {
        id: 44,
        name: "CodeQL",
        path: ".github/workflows/codeql.yml",
        state: "active",
      },
      jobs: {
        jobs: [{
          id: 55,
          name: "analyze",
          status: "completed",
          conclusion: "success",
          labels: ["self-hosted", "linux", "x64", runnerLabel],
        }],
      },
    }),
    /workflow_dispatch run for main/,
  );
});

test("owner-local receipt is ignored-path ready and written mode 0600", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "anish-local-evidence-"));
  const receipt = buildOwnerLocalEvidenceReceipt(validInput());
  const written = await writeOwnerLocalEvidenceReceipt(root, receipt);
  assert.equal(
    written.path,
    path.join(root, LOCAL_RELEASE_EVIDENCE_PATH),
  );
  assert.equal((await stat(written.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(written.path, "utf8")), receipt);
  assert.match(written.sha256, /^[a-f0-9]{64}$/u);
  await removeOwnerLocalEvidenceReceipt(root);
  await assert.rejects(() => stat(written.path), /ENOENT/u);
  await removeOwnerLocalEvidenceReceipt(root);
});
