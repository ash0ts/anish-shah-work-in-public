#!/usr/bin/env bash
set -euo pipefail

architecture="${1:-}"
label="${RUNNER_JIT_LABEL:-}"
instance_id="${RUNNER_INSTANCE_ID:-}"
max_minutes="${RUNNER_MAX_MINUTES:-75}"
[[ "$label" =~ ^anish-release-[a-f0-9]{12}$ ]]
[[ "$instance_id" =~ ^instance-[a-f0-9]{12}$ ]]
if [[ -v RUNNER_REGISTRATION_TOKEN ]]; then
  echo "RUNNER_REGISTRATION_TOKEN must not be exported; pass one token line on standard input." >&2
  exit 64
fi
token=""
IFS= read -r token || {
  echo "A repository registration token is required on standard input." >&2
  exit 64
}
extra_line=""
if IFS= read -r extra_line || [ -n "$extra_line" ]; then
  echo "Standard input must contain exactly one registration-token line." >&2
  exit 64
fi
test -n "$token"
[[ "$max_minutes" =~ ^[1-9][0-9]{0,2}$ ]]
if [ "$max_minutes" -gt 120 ]; then
  echo "RUNNER_MAX_MINUTES cannot exceed 120." >&2
  exit 64
fi
case "$architecture" in
  arm64) platform=linux/arm64 ;;
  amd64) platform=linux/amd64 ;;
  *) echo "Usage: scripts/runner/run-ephemeral.sh arm64|amd64" >&2; exit 64 ;;
esac

arguments=(
  run
  --rm
  --interactive
  --name "${label}-${instance_id}-${architecture}"
  --platform "$platform"
  --cpus 4
  --memory 10g
  --pids-limit 512
  --cap-drop ALL
  --security-opt no-new-privileges
  --network bridge
  --env RUNNER_REPOSITORY=https://github.com/ash0ts/anish-shah-work-in-public
  --env RUNNER_JIT_LABEL="$label"
  --env RUNNER_INSTANCE_ID="$instance_id"
)
if [ -n "${RUNNER_CORPORATE_CA_PATH:-}" ]; then
  test -f "$RUNNER_CORPORATE_CA_PATH"
  ca_directory="$(cd "$(dirname "$RUNNER_CORPORATE_CA_PATH")" && pwd)"
  ca_source="${ca_directory}/$(basename "$RUNNER_CORPORATE_CA_PATH")"
  arguments+=(
    --mount
    "type=bind,source=${ca_source},target=/run/anish-corporate-ca/root.crt,readonly"
  )
fi
arguments+=("anish-release-runner:$architecture")

timeout_marker="$(mktemp "${TMPDIR:-/tmp}/anish-runner-timeout.XXXXXX")"
container_name="${label}-${instance_id}-${architecture}"
watchdog_pid=""
cleanup() {
  if [ -n "$watchdog_pid" ]; then
    kill "$watchdog_pid" >/dev/null 2>&1 || true
  fi
  docker stop --time 15 "$container_name" >/dev/null 2>&1 || true
  rm -f "$timeout_marker"
}
trap cleanup EXIT INT TERM

printf '%s\n' "$token" | env -u RUNNER_REGISTRATION_TOKEN docker "${arguments[@]}" &
docker_pid=$!
unset token extra_line
(
  sleep "$((max_minutes * 60))"
  if kill -0 "$docker_pid" >/dev/null 2>&1; then
    printf 'expired\n' > "$timeout_marker"
    kill -TERM "$docker_pid" >/dev/null 2>&1 || true
  fi
) &
watchdog_pid=$!

set +e
wait "$docker_pid"
status=$?
set -e
kill "$watchdog_pid" >/dev/null 2>&1 || true
wait "$watchdog_pid" >/dev/null 2>&1 || true
watchdog_pid=""
if [ -s "$timeout_marker" ]; then
  echo "Ephemeral runner exceeded ${max_minutes} minutes and was stopped." >&2
  docker stop --time 15 "$container_name" >/dev/null 2>&1 || true
  status=124
fi
trap - EXIT INT TERM
rm -f "$timeout_marker"
exit "$status"
