import { spawnSync } from "node:child_process";

import {
  CANONICAL_GITHUB_REPOSITORY,
  githubRepositoryFromRemoteUrl,
} from "./release-contract.mjs";

const REMOTE_MAIN_REF = "refs/heads/main";
const DEFAULT_REMOTE_TIMEOUT_MS = 60_000;

function positiveTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Owner-local remote verification requires a bounded timeout.");
  }
  return value;
}

function git(root, arguments_, deadlineMs, label) {
  const timeout = deadlineMs - Date.now();
  if (timeout < 1) {
    throw new Error("Owner-local origin/main verification exceeded its deadline.");
  }
  const result = spawnSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    timeout,
    killSignal: "SIGTERM",
    maxBuffer: 1024 * 1024,
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error("Owner-local origin/main verification exceeded its deadline.");
  }
  if (result.error || result.status !== 0) {
    throw new Error(`${label} could not be verified.`);
  }
  return result.stdout.trim();
}

export function assertOwnerLocalRemoteMainResponse(output, expectedHead) {
  const head = String(expectedHead ?? "").toLowerCase();
  const lines = String(output ?? "")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  const match = lines.length === 1
    ? lines[0].match(/^([a-f0-9]{40})\trefs\/heads\/main$/u)
    : null;
  if (!match || match[1] !== head) {
    throw new Error(
      "Owner-local release evidence requires HEAD to equal the live canonical origin/main head.",
    );
  }
  return { head, ref: REMOTE_MAIN_REF };
}

/**
 * Re-query the canonical GitHub remote so a locally forged or stale
 * origin/main tracking ref cannot authorize an owner-local production release.
 */
export function verifyOwnerLocalRemoteMain({
  root,
  head,
  timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS,
}) {
  const deadlineMs = Date.now() + positiveTimeout(timeoutMs);
  const fetchRepository = githubRepositoryFromRemoteUrl(
    git(root, ["remote", "get-url", "origin"], deadlineMs, "Origin fetch URL"),
  );
  const pushRepository = githubRepositoryFromRemoteUrl(
    git(
      root,
      ["remote", "get-url", "--push", "origin"],
      deadlineMs,
      "Origin push URL",
    ),
  );
  if (
    fetchRepository !== CANONICAL_GITHUB_REPOSITORY ||
    pushRepository !== CANONICAL_GITHUB_REPOSITORY
  ) {
    throw new Error(
      "Owner-local release evidence requires canonical origin fetch and push URLs.",
    );
  }
  const output = git(
    root,
    ["ls-remote", "--refs", "origin", REMOTE_MAIN_REF],
    deadlineMs,
    "Live origin/main",
  );
  return assertOwnerLocalRemoteMainResponse(output, head);
}
