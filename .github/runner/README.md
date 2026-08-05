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

Obtain the short-lived repository registration token from GitHub repository
**Settings → Actions → Runners → New self-hosted runner**. Copy only the token
shown after `--token` in GitHub's generated configuration command; do not run
that command, save it, or paste it into shell history. The hidden prompt below
is where that token goes:

```bash
export RUNNER_JIT_LABEL="anish-release-$(openssl rand -hex 6)"
export RUNNER_INSTANCE_ID="instance-$(openssl rand -hex 6)"
export RUNNER_CORPORATE_CA_PATH='/absolute/path/to/corporate-root.crt' # optional
export RUNNER_MAX_MINUTES=75 # optional; accepted range 1-120

unset RUNNER_TOKEN RUNNER_REGISTRATION_TOKEN
printf 'Paste the short-lived repository runner token: '
IFS= read -r -s RUNNER_TOKEN
printf '\n'
printf '%s\n' "$RUNNER_TOKEN" | scripts/runner/run-ephemeral.sh arm64
unset RUNNER_TOKEN
```

An owner with repository-administration access may instead keep the token out
of the terminal entirely by piping the GitHub CLI response directly into the
launcher:

```bash
gh api --method POST \
  repos/ash0ts/anish-shah-work-in-public/actions/runners/registration-token \
  --jq .token | scripts/runner/run-ephemeral.sh arm64
```

In either path, create one token for one ephemeral registration and never
print, persist, reuse, or place it in a GitHub secret.

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

GitHub does not bill self-hosted runner minutes. The owner still pays for the
local machine's compute and network use, so keep concurrency at one evidence
job or two optional soak workers and destroy every container after its single
job.

## Dispatch exact-SHA evidence

Dispatch the four release-evidence workflows from a trusted owner-controlled
workflow branch, checking out one already-pushed commit. Use `main` for an
ordinary merged release or the active `release/*` branch while validating a
release candidate; never use an unreviewed feature branch as `WORKFLOW_REF`:

```bash
export VALIDATED_SHA='<full 40-character pushed commit SHA>'
export RELEASE_LINE="$(node -p "require('./package.json').version.split('-')[0]")"
export WORKFLOW_REF="release/$RELEASE_LINE" # use main only for an authorized final release

export VALIDATE_LABEL="anish-release-$(openssl rand -hex 6)"
export GITLEAKS_LABEL="anish-release-$(openssl rand -hex 6)"
export CODEQL_LABEL="anish-release-$(openssl rand -hex 6)"

gh workflow run ci.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f runner_target=owner-arm64 -f jit_label="$VALIDATE_LABEL"
gh workflow run gitleaks.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f runner_target=owner-arm64 -f jit_label="$GITLEAKS_LABEL"
gh workflow run codeql.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f runner_target=owner-amd64 -f jit_label="$CODEQL_LABEL"
```

Start one matching ephemeral container for each label after dispatch, using a
fresh `RUNNER_INSTANCE_ID=instance-<12 lowercase hex>` and piping exactly one
short-lived registration-token line as documented in the runner README. The
selected SHA must equal the pushed head of `WORKFLOW_REF`; ancestors, arbitrary
feature commits, and other SHAs are rejected.

Wait for Validate to finish and record its numeric run ID. Browser Quality
downloads and verifies that run's immutable `dist`; it never rebuilds. The
bounded release-smoke suite stays on Chromium except for one Spotify Ranked Groove interaction
in WebKit. That check complements rather than replaces the manual Safari staging
acceptance in the staging runbook:

```bash
export VALIDATE_RUN_ID='<successful Validate run ID>'
export BROWSER_LABEL="anish-release-$(openssl rand -hex 6)"
gh workflow run browser-quality.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f validate_run_id="$VALIDATE_RUN_ID" \
  -f runner_target=owner-arm64 -f jit_label="$BROWSER_LABEL"
```

Run the optional stability soak only after Room, Travel input, or browser-harness
changes require exhaustive repeated-interaction and visual evidence:

```bash
export SOAK_LABEL="anish-release-$(openssl rand -hex 6)"
gh workflow run browser-stability.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f validate_run_id="$VALIDATE_RUN_ID" \
  -f runner_target=owner-arm64 -f jit_label="$SOAK_LABEL"
```

For the soak only, create one fresh `SOAK_LABEL` and start exactly two ephemeral
ARM64 containers with that same label but distinct `RUNNER_INSTANCE_ID` values.
This lets both matrix jobs claim a runner without a Docker/GitHub runner-name
collision and prevents fan-out beyond the intended capacity.

Use the resulting Actions run URLs normally. A self-hosted run does not waive
or replace any assertion, artifact, browser, security, or release-plan check.
