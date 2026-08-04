#!/usr/bin/env bash
set -euo pipefail

test "${GITHUB_REPOSITORY:-}" = "ash0ts/anish-shah-work-in-public"
test "${GITHUB_REPOSITORY_OWNER:-}" = "ash0ts"
test "${GITHUB_ACTOR:-}" = "ash0ts"
test "${GITHUB_EVENT_NAME:-}" = "workflow_dispatch"
[[ "${GITHUB_REF:-}" =~ ^refs/heads/(main|release/[0-9]+\.[0-9]+\.[0-9]+)$ ]]
[[ "${GITHUB_WORKFLOW:-}" =~ ^(Validate|Gitleaks|CodeQL|Browser\ Quality|Browser\ stability\ soak)$ ]]
test -f "${GITHUB_EVENT_PATH:-}"

requested_sha="$(jq -er '.inputs.commit_sha' "$GITHUB_EVENT_PATH")"
[[ "$requested_sha" =~ ^[0-9a-f]{40}$ ]]
test "$requested_sha" = "$GITHUB_SHA"
test "$(jq -er '.repository.full_name' "$GITHUB_EVENT_PATH")" = "$GITHUB_REPOSITORY"
test "$(jq -er '.sender.login' "$GITHUB_EVENT_PATH")" = "$GITHUB_REPOSITORY_OWNER"
