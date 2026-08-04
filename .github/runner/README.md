# Disposable exact-SHA release runners

These containers collect the four release-evidence workflows without consuming
GitHub-hosted minutes. They are not deployment machines and receive no
Cloudflare, provider, staging, production, D1, KV, R2, or SSH credentials.

The Ubuntu 24.04 images, Node 24.18.0 archives, npm 11.6.2, Playwright 1.62.1,
and GitHub runner 2.336.0 are exact pins. The image build verifies the published
Node and runner SHA-256 values before extraction. Optional corporate CA input is
a BuildKit secret used only by the networked build step. It is removed before
each layer is committed and is never part of the resulting image. The build
script creates a temporary allowlisted context containing only the Dockerfile,
entrypoint, and job-start hook; the repository is never sent to Docker.

The ARM64 image includes Chromium for the complete browser suite and WebKit for
one narrowly scoped Spotify Ranked Groove interaction. WebKit is automated
engine evidence; final staging acceptance still includes a manual Safari check.
The AMD64 CodeQL image omits both browsers and their operating-system packages.

Build native ARM64 for Validate, Gitleaks, Browser Quality, and soak work. Build
AMD64 only for CodeQL:

```bash
OWNER_CA_FILE='/absolute/path/to/corporate-root.crt' \
  scripts/runner/build-image.sh arm64
OWNER_CA_FILE='/absolute/path/to/corporate-root.crt' \
  scripts/runner/build-image.sh amd64
```

Create a fresh unpredictable scheduling label, runner instance ID, and
repository registration token for each evidence job. Start exactly one
container per workflow job. The optional two-worker soak uses one shared
scheduling label and two different instance IDs.

```bash
export RUNNER_JIT_LABEL="anish-release-$(openssl rand -hex 6)"
export RUNNER_INSTANCE_ID="instance-$(openssl rand -hex 6)"
export RUNNER_CORPORATE_CA_PATH='/absolute/path/to/corporate-root.crt' # optional
export RUNNER_MAX_MINUTES=75 # optional; accepted range 1-120

unset RUNNER_TOKEN RUNNER_REGISTRATION_TOKEN
IFS= read -r -s RUNNER_TOKEN
printf '\n'
printf '%s\n' "$RUNNER_TOKEN" | scripts/runner/run-ephemeral.sh arm64
unset RUNNER_TOKEN
```

The runner is ephemeral, runs non-root, mounts no host directories or Docker
socket, drops every Linux capability, enables `no-new-privileges`, is resource-
capped, and deregisters after one job. The optional CA is the only permitted
read-only host-file mount. A baked job-start hook rejects
non-owner dispatches, PR events, unapproved workflows, foreign repositories,
and refs outside `main` or an exact `release/<semver>` branch. When supplied at
runtime, the CA is mounted as one read-only file and combined with the system
bundle only in the container's ephemeral `/tmp`; the image and repository never
contain it. The workflow also proves that the selected SHA equals the current
head of the trusted dispatch ref before running repository scripts. A local
watchdog stops and removes a runner that exceeds the configured wall-clock
limit. The registration token is read as exactly one standard-input line; it is
never accepted from an exported environment variable or retained in Docker
configuration.

An ephemeral runner normally deregisters after its assigned job. A registration
that times out before claiming a job can remain offline in the repository's
Actions runner list briefly. After any timeout or interrupted launch, the owner
must remove that exact `${RUNNER_JIT_LABEL}-${RUNNER_INSTANCE_ID}-*` entry in
repository Settings → Actions → Runners and must not reuse either identifier. No
long-lived administration token is passed into the container for cleanup.
