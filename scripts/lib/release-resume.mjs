import { REQUIRED_VALIDATION_RUNS } from "./release-contract.mjs";
import { verifyCoverage } from "./release-coverage.mjs";

export function assertBrowserArtifact(report, { sha, artifactSha256, baseSha, modes }) {
  if (report?.status !== "passed" || report.identity?.sourceSha !== sha || report.identity?.artifactSha256 !== artifactSha256 ||
      !Array.isArray(report.phases) || report.phases.length === 0 || report.phases.some(({ status }) => status !== "passed")) {
    throw new Error("Browser evidence does not match the validated build.");
  }
  if (report.coverage?.mode === "conservative-full") {
    if (JSON.stringify(report.coverage.scopes) !== JSON.stringify(["critical", "public", "objects", "room", "travel"])) throw new Error("Incomplete conservative browser coverage.");
    if (modes && (modes.simulationExperienceMode !== "disabled" || modes.simulationAiMode !== "authored-only" || modes.travelAtlasMode !== "atlas-v1")) throw new Error("Non-default feature modes require explicit browser coverage.");
  } else {
    verifyCoverage(report.coverage);
    if (!baseSha || report.coverage.baseSha !== baseSha || report.coverage.candidateSha !== sha) throw new Error("Browser evidence uses a different deployed baseline.");
    if (modes && Object.entries(modes).some(([key, value]) => report.coverage.modes[key] !== value)) throw new Error("Browser evidence uses different feature modes.");
  }
}

export function selectReleaseEvidence(runs, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Release SHA must be exact.");
  return REQUIRED_VALIDATION_RUNS.map(({ kind, name, workflowPath }) => {
    const run = runs.filter((entry) => entry.head_sha === sha && entry.name === name && entry.path === workflowPath &&
      ["push", "workflow_dispatch"].includes(entry.event))
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    return { kind, name, runId: run?.id ?? null, url: run?.html_url ?? null,
      status: !run ? "missing" : run.status !== "completed" ? "running" : run.conclusion === "success" ? "passed" : "failed" };
  });
}

export function runnerMinutes(jobs) {
  return jobs.reduce((total, job) => {
    const start = Date.parse(job.started_at), end = Date.parse(job.completed_at);
    return total + (Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 60_000 : 0);
  }, 0);
}
