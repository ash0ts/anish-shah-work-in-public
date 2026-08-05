# Local setup and validation

This is the sole authority for local setup, development servers, and validation
selection. Release commands and production smoke tests belong only in the
[production runbook](./operations/release.md).

## Fresh clone

Use Node `24.18.0` and npm `11.6.2` as pinned by `.node-version` and
`packageManager`.

```bash
npm install --global npm@11.6.2 --ignore-scripts
npm ci
npm run setup:local
```

`setup:local` is safe to rerun. It creates `.env.local` from `.env.example`
when absent, fills only missing or blank `CONNECTOR_ENCRYPTION_KEY` and
`RATE_LIMIT_SALT` values with independent random 32-byte values, writes
atomically, and applies mode `0600`. It never prints or replaces a value. It
refuses CI, hosted origins, non-loopback configuration, and duplicate keys.

After bootstrap, set `OWNER_EMAILS` and `LOCAL_OWNER_EMAIL` to the same owner
address. `SITE_URL` must remain an exact loopback origin and
`PRODUCTION_SITE_URL` must remain `https://anish-shah-is.online` for the bounded
promotion workflow. Do not copy the local encryption key or D1 state to another
tier.

Then verify the completed local configuration:

```bash
npm run doctor
```

`doctor` is read-only. It checks the pinned toolchain, lockfile installation,
environment presence and permissions without printing values, owner/loopback
consistency, local D1 and migration inventory, the actual pinned Playwright
Chromium executable, Safari/Chromium availability for manual review, ports 3000
and 3001, and the authoritative My Room runtime. Fix every `FAIL`; review `WARN` output
before treating a machine as release-capable.

## Development servers

```bash
npm run dev:studio
```

This applies local migrations and starts My Room, 2001 at
`http://localhost:3000`. The loopback-only owner fallback is accepted only in
development. Stop a conflicting process rather than silently changing the
OAuth callback port.

My Room and its seven semantic object routes are the only Play runtime. Legacy
`?stream=` links receive permanent redirects to the matching object route;
there is no Classic development or hosted lane.

## Fast checks by change type

```bash
# classify changed files and print required checks
node .agents/skills/maintain-anish-site/scripts/check-change.mjs --plan --base origin/main

# execute the selected checks
node .agents/skills/maintain-anish-site/scripts/check-change.mjs --run --base origin/main

# complete local handoff suite; never deploys or mutates remote state
node .agents/skills/maintain-anish-site/scripts/check-change.mjs --full --base origin/main
```

Focused commands:

```bash
npm run copy:check
npm run copy:diff -- --base origin/main
npm run copy:test
npm run docs:check
npm run skill:validate
npm run typecheck
npm run lint
npm run test:backend
```

Use `npm ci`, not `npm install`, for reproducible review and CI.

## Authoritative non-browser gate

```bash
npm run validate
```

`validate` checks the copy deck and `COPY_VERSION`, public-content attestation,
documentation and skill structure, lint, a clean local D1 migration, content
and privacy contracts, backend authorization/security, the production build,
rendered routes, bundle/privacy closure, and dependency advisories. The build is
created once inside the command and reused by its candidate checks.

Local development runs the Meet Me campaign with deterministic authored model
fixtures. It must not need Cloudflare or Anthropic credentials:

```bash
SIMULATION_EXPERIENCE_MODE=campaign-v1 \
SIMULATION_AI_MODE=fixture \
npm run dev:studio
```

To smoke-test real Claude behavior locally, keep the provider key in an existing
owner-only environment file and pass that file to the guarded launcher:

```bash
npm run dev:simulation:live -- \
  --env-file '/absolute/path/to/permission-restricted/.env'
```

The launcher reads only `ANTHROPIC_API_KEY`, removes every variable declared by
that shared file from the child environment, and binds the key only to the
loopback development Worker for that process lifetime. The key is never copied
into `.env.local`, Git, D1, the browser, or a build artifact. The direct
transport is accepted only for an exact `http://localhost:3000` development
origin; preview, staging, production, non-loopback origins, and
`NODE_ENV=production` fail closed. Stop it with Control-C. A generated turn is labeled
`Generated reaction · facts supplied by server` in the opponent panel.

This direct local smoke test proves model compatibility and the authored fallback. It
is not release evidence for Cloudflare AI Gateway, Gateway logging/DLP,
Guardrails, BYOK, hosted rate limiting, provider approvals, or spend controls.
Those remain staging acceptance requirements.

`npm run setup:local` creates a missing ignored
`SIMULATION_SESSION_HMAC_KEY` alongside the other local-only security values
without printing any of them. Apply the normal local migration command before
testing sessions. Never put a Gateway token, BYOK alias, provider key, or hosted
approval record in a fixture or checked-in environment file.

Run the manually dispatched Validate, Gitleaks, CodeQL, and Browser Quality
workflows with the same full 40-character commit SHA before release. The
checkout step rejects a different commit. Browser stability is a separate,
optional exhaustive interaction soak and is not release-plan evidence.

## Temporary owner runner

Ordinary PRs use the path-classified `PR Gate`; full exact-SHA release evidence
is owner-dispatched. When hosted minutes are unavailable, use the checked-in
disposable runner image documented in [`.github/runner/README.md`](../.github/runner/README.md).

The image pins Ubuntu 24.04 by architecture-specific digest, Node 24.18.0, npm
11.6.2, Playwright 1.62.1, and GitHub runner 2.336.0. Downloaded Node and runner
archives are SHA-256 verified. Build native ARM64 for Validate, Gitleaks, and
Browser Quality; use the AMD64 image only for CodeQL. This avoids repeated x64
emulation while preserving CodeQL compatibility.

Each evidence run uses an unpredictable label matching
`anish-release-<12 lowercase hex>` and one or two ephemeral repository runners.
A baked job-start hook rejects non-owner dispatches, PR events, unapproved
workflow names, foreign repositories, and refs outside `main` or an exact
`release/<semver>` branch. The workflow also proves that the requested commit is
the current head of that trusted ref before running repository scripts. The
container runs non-root, mounts no host directory or Docker socket, is
CPU/memory/PID bounded, and receives no application or hosted environment
secrets. Its short-lived repository registration token is the only credential
required to register and is unset before the job starts.

If the network requires an owner corporate CA, pass it during image creation as
`OWNER_CA_FILE` and during execution as `RUNNER_CORPORATE_CA_PATH`. The build
secret is removed before image layers are committed. At runtime exactly one CA
file is mounted read-only, combined with the system bundle in ephemeral `/tmp`,
and exposed through `NODE_EXTRA_CA_CERTS`, `GIT_SSL_CAINFO`, and `SSL_CERT_FILE`.
Never copy the CA into the image, repository, or a GitHub secret, and never
disable TLS verification.

GitHub does not bill self-hosted runner minutes. The owner still pays for the
local machine's compute and network use, so keep concurrency at one evidence
job or two optional soak workers and destroy every container after its single
job.

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

Private-source regeneration is an owner operation because CI does not possess
the immutable CSV/Markdown inputs. After a deliberate regeneration:

```bash
node scripts/build-content.mjs
npm run verify:content
npm run content:attest:write
npm run content:attest
```

Commit the public projection, schema/report changes, curation, and safe
attestation together. Never commit `content/private/`.

## Browser, accessibility, and performance gate

Install the pinned Chromium and WebKit builds once:

```bash
npx --no-install playwright install chromium webkit
npm run validate:browser
```

The browser gate builds once, then reuses the same `dist` for:

- public route, keyboard, focus, consent, reflow, and overflow checks;
- critical My Room and Pocket Room entry, navigation, focus, and fallback behavior;
- direct `/play/watch`, `/play/read`, `/play/listen`, `/play/collect`,
  `/play/play`, `/play/move`, and `/play/travel` route isolation;
- reduced-motion, forced-colors, Save-Data, zoom, no-JavaScript, and static
  poster paths;
- Axe serious/critical checks;
- Lighthouse mobile budgets of at least 0.90 with CLS no greater than 0.1.

The release gate first runs Simulation's no-JavaScript and room-reveal fallback
foundations in one short isolated process, then runs at most two Chromium
processes for the normal and WebGL-heavy coverage. It uses no test retries,
cancels remaining work on the first failure, reuses one Worker and browser for
all Lighthouse routes, and gives its child processes a combined 15-minute hard
budget. This prevents a SwiftShader-heavy room process from starving a newly
created no-JavaScript Chromium renderer on a bounded release runner without
weakening or retrying the assertion.
Twenty-fold click/drag loops, all-object Pocket stress, performance-downgrade
stress, and room-review captures belong to the separate manual stability soak.

The local browser harness uses the pinned `wrangler-e2e` alias only. Production
build and deployment continue using the repository’s production Wrangler
version. Browser jobs wait for semantic room readiness with a 15-second SLO and
capture diagnostic state on failure.

Run the manually dispatched Browser stability workflow only after changing the
Room, Travel input, or browser harness, or while containing flakiness. It reuses
one validated build and partitions one exhaustive pass across exactly two
ephemeral workers. A rerun never converts an earlier failure into evidence for
the failed SHA; diagnose and push a fix first.

Travel coverage additionally verifies the server-rendered atlas and trip pages,
country/admin-1 synchronization, click-versus-drag behavior, active-snapshot
media authorization, upload bounds, EXIF removal, atomic publication, and the
disabled-mode 404/sitemap boundary. Preview uses synthetic Travel data and has
no R2 binding.

Simulation browser coverage must exercise both Action and Tactical completion,
the semantic no-JavaScript dossier, reduced-motion/forced-colors/Save-Data
fallbacks, and authored completion during a total model outage. Assert that:

- `/simulation` is absent when the feature is disabled;
- Tactical never downloads Phaser;
- Action downloads Phaser only after the visitor selects it;
- Tone.js is absent until `SOUND ON`;
- raw free-text requests, prompts, and provider/model responses never appear in
  stored state, logs, rendered HTML, or artifacts; the server may retain only
  its schema-validated safe response projection for bounded idempotent replay;
  and
- a model timeout, invalid schema, DLP block, Guardrail block, exhausted budget,
  or missing Gateway configuration resolves to authored dialogue.

The focused backend and release suites are:

```bash
node --test tests/simulation-backend.test.mjs
node --test tests/release-guards.test.mjs tests/staging-preview.test.mjs
```

Release-quality live AI testing happens only on isolated staging after its
Gateway, spend cap, DLP/Guardrails, provider approvals, session key, D1, and
rate limiter are configured. A successful direct local smoke test, fixture, or
PR preview is not hosted live-model evidence.

## CI and exact-SHA release evidence

Normal PRs run one stable `PR Gate` plus Gitleaks. The gate classifies docs,
copy, backend/connectors, general UI, Room, Simulation, Travel, and full
dependency/release changes. It builds at most once and runs only affected
browser scopes. CodeQL runs for source/security/dependency/workflow paths and on
its weekly schedule. Code previews require the owner-applied `preview` label;
trusted copy-only previews remain automatic.

Pushes to `main` intentionally run Validate, Gitleaks, and CodeQL once to keep a
known-good merged baseline. Pushes to `release/*` do not automatically repeat
those expensive workflows: the owner dispatches all four evidence identities
for one exact release SHA. Copy-only PRs intentionally have a cheap parser/test
lane in `PR Gate` and a separate trusted copy-preview lane. The latter rebuilds
base-branch code with only validated plain-text copy applied so screenshots can
be produced without executing contributor-authored scripts; this is a security
boundary, not accidental duplicate validation.

Every staging or production release nevertheless requires four distinct,
successful runs for the exact 40-character SHA:

1. `Validate` from `.github/workflows/ci.yml`
2. `Gitleaks` from `.github/workflows/gitleaks.yml`
3. `CodeQL` from `.github/workflows/codeql.yml`
4. manually dispatched `Browser Quality` from `.github/workflows/browser-quality.yml`

The release planner verifies repository, workflow identity/path, active state,
event type where required, conclusion, URL, and commit SHA. See the environment
variables and guarded artifact flow in [Production release](./operations/release.md).
