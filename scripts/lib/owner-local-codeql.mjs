import { spawnSync } from "node:child_process";

import {
  assertActiveActionsWorkflow,
  assertRequiredCodeqlValidationRun,
  assertVerifiedActionsRun,
  CANONICAL_GITHUB_REPOSITORY,
  OWNER_LOCAL_CODEQL_RUNNER_LABEL_PATTERN,
  REQUIRED_VALIDATION_RUNS,
} from "./release-contract.mjs";

function exactRunCoordinates(rawUrl, repository) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("RELEASE_CODEQL_URL must be an exact GitHub Actions run URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.search ||
    url.hash ||
    !/^\/[^/]+\/[^/]+\/actions\/runs\/[1-9][0-9]*\/?$/u.test(url.pathname)
  ) {
    throw new Error("RELEASE_CODEQL_URL must be an exact GitHub Actions run URL.");
  }
  const [, owner, name, , , runId] = url.pathname.split("/");
  if (
    repository !== CANONICAL_GITHUB_REPOSITORY ||
    `${owner.toLowerCase()}/${name.toLowerCase()}` !== repository
  ) {
    throw new Error("RELEASE_CODEQL_URL must belong to the canonical repository.");
  }
  return { owner, name, runId, url: url.toString() };
}

function exactRunnerJob(jobs, runnerLabel) {
  const candidates = Array.isArray(jobs?.jobs)
    ? jobs.jobs.filter((job) => job?.name === "analyze")
    : [];
  if (candidates.length !== 1) {
    throw new Error("CodeQL evidence must contain exactly one analyze job.");
  }
  const job = candidates[0];
  const labels = Array.isArray(job.labels)
    ? [...new Set(job.labels.map((label) => String(label).toLowerCase()))].sort()
    : [];
  if (
    !Number.isSafeInteger(job.id) ||
    job.id < 1 ||
    job.status !== "completed" ||
    job.conclusion !== "success" ||
    !["self-hosted", "linux", "x64", runnerLabel].every((label) =>
      labels.includes(label),
    )
  ) {
    throw new Error(
      "CodeQL did not pass on the exact disposable self-hosted Linux x64 runner.",
    );
  }
  return {
    jobDatabaseId: job.id,
    jobName: "analyze",
    jitLabel: runnerLabel,
    labels,
  };
}

export function ownerLocalCodeqlEvidenceFromResponses({
  head,
  repository,
  url,
  runnerLabel,
  run,
  workflow,
  jobs,
}) {
  if (!OWNER_LOCAL_CODEQL_RUNNER_LABEL_PATTERN.test(runnerLabel ?? "")) {
    throw new Error(
      "RELEASE_CODEQL_RUNNER_LABEL must identify one disposable owner runner.",
    );
  }
  const coordinates = exactRunCoordinates(url, repository);
  assertVerifiedActionsRun(run, {
    head,
    url: coordinates.url,
    name: "CodeQL",
  });
  if (run.event !== "workflow_dispatch" || run.headBranch !== "main") {
    throw new Error(
      "Owner-local CodeQL evidence must be a workflow_dispatch run for main.",
    );
  }
  const definition = REQUIRED_VALIDATION_RUNS.find(
    ({ kind }) => kind === "codeql",
  );
  if (!definition) throw new Error("The CodeQL workflow contract is missing.");
  const workflowIdentity = assertActiveActionsWorkflow(workflow, {
    workflowDatabaseId: run.workflowDatabaseId,
    name: definition.name,
    workflowPath: definition.workflowPath,
  });
  const evidence = {
    kind: "codeql",
    name: run.name,
    headSha: run.headSha,
    conclusion: run.conclusion,
    url: run.url,
    event: run.event,
    ...workflowIdentity,
    runner: exactRunnerJob(jobs, runnerLabel),
  };
  assertRequiredCodeqlValidationRun(
    [evidence],
    head,
    repository,
    runnerLabel,
  );
  return evidence;
}

function ghJson(root, arguments_, failureMessage) {
  const result = spawnSync("gh", arguments_, {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    killSignal: "SIGTERM",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(failureMessage);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${failureMessage} The response was unreadable.`);
  }
}

export function verifyOwnerLocalCodeqlEvidence({
  root,
  head,
  repository,
  url,
  runnerLabel,
}) {
  const coordinates = exactRunCoordinates(url, repository);
  const run = ghJson(
    root,
    [
      "run",
      "view",
      coordinates.runId,
      "--repo",
      `${coordinates.owner}/${coordinates.name}`,
      "--json",
      "headSha,headBranch,conclusion,url,name,event,workflowDatabaseId",
    ],
    "CodeQL GitHub Actions evidence could not be verified.",
  );
  const workflow = ghJson(
    root,
    [
      "api",
      `repos/${coordinates.owner}/${coordinates.name}/actions/workflows/${run.workflowDatabaseId}`,
    ],
    "CodeQL workflow identity could not be verified.",
  );
  const jobs = ghJson(
    root,
    [
      "api",
      `repos/${coordinates.owner}/${coordinates.name}/actions/runs/${coordinates.runId}/jobs?filter=latest&per_page=100`,
    ],
    "CodeQL runner provenance could not be verified.",
  );
  return ownerLocalCodeqlEvidenceFromResponses({
    head,
    repository,
    url: coordinates.url,
    runnerLabel,
    run,
    workflow,
    jobs,
  });
}

export function reverifyPlannedOwnerLocalCodeqlEvidence({
  root,
  head,
  repository,
  validationRuns,
}) {
  if (!Array.isArray(validationRuns) || validationRuns.length !== 1) {
    throw new Error("Owner-local release evidence must retain one CodeQL run.");
  }
  const planned = validationRuns[0];
  const live = verifyOwnerLocalCodeqlEvidence({
    root,
    head,
    repository,
    url: planned?.url,
    runnerLabel: planned?.runner?.jitLabel,
  });
  if (JSON.stringify(live) !== JSON.stringify(planned)) {
    throw new Error(
      "The live CodeQL run, active workflow, or disposable-runner provenance no longer matches the release plan.",
    );
  }
  return live;
}
