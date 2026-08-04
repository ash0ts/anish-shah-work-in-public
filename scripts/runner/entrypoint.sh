#!/usr/bin/env bash
set -euo pipefail

repository="${RUNNER_REPOSITORY:-}"
label="${RUNNER_JIT_LABEL:-}"
instance_id="${RUNNER_INSTANCE_ID:-}"
test "$repository" = "https://github.com/ash0ts/anish-shah-work-in-public"
IFS= read -r token
test -n "$token"
[[ "$label" =~ ^anish-release-[a-f0-9]{12}$ ]]
[[ "$instance_id" =~ ^instance-[a-f0-9]{12}$ ]]

case "$(uname -m)" in
  aarch64) architecture_label=arm64 ;;
  x86_64) architecture_label=x64 ;;
  *) echo "Unsupported runner architecture." >&2; exit 64 ;;
esac

runtime_ca=/run/anish-corporate-ca/root.crt
if [ -e "$runtime_ca" ]; then
  test -f "$runtime_ca"
  test ! -L "$runtime_ca"
  test -r "$runtime_ca"
  grep -q -- "-----BEGIN CERTIFICATE-----" "$runtime_ca"
  umask 077
  combined_ca=/tmp/anish-release-ca.pem
  cat /etc/ssl/certs/ca-certificates.crt "$runtime_ca" > "$combined_ca"
  export NODE_EXTRA_CA_CERTS="$combined_ca"
  export GIT_SSL_CAINFO="$combined_ca"
  export SSL_CERT_FILE="$combined_ca"
fi

export ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/anish-runner/job-started-hook.sh
./config.sh \
  --url "$repository" \
  --token "$token" \
  --name "${label}-${instance_id}-${architecture_label}" \
  --work /home/runner/_work \
  --labels "self-hosted,linux,${architecture_label},${label}" \
  --no-default-labels \
  --ephemeral \
  --disableupdate \
  --unattended

unset token
exec ./run.sh
