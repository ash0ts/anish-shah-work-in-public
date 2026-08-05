#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
context="$(mktemp -d "${TMPDIR:-/tmp}/anish-release-runner-context.XXXXXX")"
cleanup() {
  rm -rf "$context"
}
trap cleanup EXIT INT TERM

install -m 0444 "$root/.github/runner/Dockerfile" "$context/Dockerfile"
install -m 0555 "$root/scripts/runner/entrypoint.sh" "$context/entrypoint.sh"
install -m 0555 "$root/scripts/runner/job-started-hook.sh" "$context/job-started-hook.sh"

architecture="${1:-}"
case "$architecture" in
  arm64)
    platform=linux/arm64
    base_image='ubuntu@sha256:b17516cd982bf06bdd5d5600253d12a8de017b9eb831cc052b532a0363d294f9'
    node_arch=arm64
    node_sha=58c9520501f6ae2b52d5b210444e24b9d0c029a58c5011b797bc1fe7105886f6
    runner_arch=arm64
    runner_sha=58b758e420b87093fbd4bfddd368074960053e2f1388f01848c82624b90f27d1
    install_browsers=1
    ;;
  amd64)
    platform=linux/amd64
    base_image='ubuntu@sha256:019e8eb29a85e74d64925745884f2ec79aa27e3feab36353d24656f4d6b89467'
    node_arch=x64
    node_sha=55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742
    runner_arch=x64
    runner_sha=04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d
    install_browsers=0
    ;;
  *)
    echo "Usage: scripts/runner/build-image.sh arm64|amd64" >&2
    exit 64
    ;;
esac

arguments=(
  build
  --file "$context/Dockerfile"
  --platform "$platform"
  --build-arg "BASE_IMAGE=$base_image"
  --build-arg "NODE_ARCH=$node_arch"
  --build-arg "NODE_SHA256=$node_sha"
  --build-arg "RUNNER_ARCH=$runner_arch"
  --build-arg "RUNNER_SHA256=$runner_sha"
  --build-arg "INSTALL_BROWSERS=$install_browsers"
  --tag "anish-release-runner:$architecture"
)
if [ -n "${OWNER_CA_FILE:-}" ]; then
  test -f "$OWNER_CA_FILE"
  arguments+=(--secret "id=corporate_ca,src=$OWNER_CA_FILE")
fi
arguments+=("$context")
docker "${arguments[@]}"
