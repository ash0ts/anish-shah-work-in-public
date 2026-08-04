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
and 3001, and the default My Room mode. Fix every `FAIL`; review `WARN` output
before treating a machine as release-capable.

## Development servers

```bash
npm run dev:studio
```

This applies local migrations and starts My Room, 2001 at
`http://localhost:3000`. The loopback-only owner fallback is accepted only in
development. Stop a conflicting process rather than silently changing the
OAuth callback port.

Classic Play is retained for one cleanup window and must be requested
explicitly:

```bash
npm run dev:classic
npm run dev:studio:classic
```

Do not rely on Classic behavior for new work. Production, staging, and PR
previews declare `PLAY_EXPERIENCE_MODE` explicitly; missing hosted mode
configuration fails closed.

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
optional ten-run soak and is not release-plan evidence.

## Temporary owner runner

Automatic pull-request jobs and `main` push jobs always use GitHub-hosted
`ubuntu-latest` runners. Feature branches are validated by their pull request;
Validate does not also run for every `codex/**` branch push.

When hosted Actions capacity is temporarily unavailable, the repository owner
may manually dispatch the same exact workflows with `runner_label` set to
`anish-release`. Each workflow rejects a dispatch whose actor is not the
repository owner or whose `commit_sha` is not exactly 40 lowercase hexadecimal
characters. The workflow names, paths, read-only permissions, exact-SHA checks,
and release-evidence contract remain unchanged.

The runner is a temporary repository runner, not a release machine. Register a
clean runner with the custom label `anish-release`, using a dedicated OS account
and working directory. Do not put Cloudflare credentials, provider tokens,
local `.env` files, D1 state, browser profiles, SSH agents, signing keys, or
other durable secrets in its service environment or working directory. Keep it
online until all jobs in a dispatched workflow finish—Browser Quality and the
stability soak contain multiple jobs—then stop and remove its registration.
The workflows do not select a GitHub environment or reference repository or
environment secrets; actions receive only the workflow's short-lived,
read-only `GITHUB_TOKEN`.

Dispatch the four release-evidence workflows from a trusted owner-controlled
workflow branch, checking out one already-pushed commit. Use `main` for an
ordinary merged release or the active `release/*` branch while validating a
release candidate; never use an unreviewed feature branch as `WORKFLOW_REF`:

```bash
export VALIDATED_SHA='<full 40-character pushed commit SHA>'
export WORKFLOW_REF='release/2.0.0' # or main

gh workflow run ci.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
gh workflow run gitleaks.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
gh workflow run codeql.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
gh workflow run browser-quality.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
```

Run the optional stability soak only when its explicit ten-run evidence is
required:

```bash
gh workflow run browser-stability.yml --ref "$WORKFLOW_REF" \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
```

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

Install the pinned Chromium build once:

```bash
npx --no-install playwright install chromium
npm run validate:browser
```

The browser gate builds once, then reuses the same `dist` for:

- public route, keyboard, focus, consent, reflow, and overflow checks;
- My Room public behavior and five fresh-runner interaction shards;
- direct `/play/watch`, `/play/read`, `/play/listen`, `/play/collect`,
  `/play/play`, and `/play/move` route isolation;
- reduced-motion, forced-colors, Save-Data, zoom, no-JavaScript, and static
  poster paths;
- Axe serious/critical checks;
- room review screenshots and recording; and
- Lighthouse mobile budgets of at least 0.90 with CLS no greater than 0.1.

The local browser harness uses the pinned `wrangler-e2e` alias only. Production
build and deployment continue using the repository’s production Wrangler
version. Browser jobs wait for semantic room readiness with a 15-second SLO and
capture diagnostic state on failure.

Run the manually dispatched ten-run Browser stability workflow after changing
the room harness or containing flakiness. All ten independent jobs must pass on
the same full SHA; a single successful rerun is not stability evidence.

Simulation browser coverage must exercise both Action and Tactical completion,
the semantic no-JavaScript dossier, reduced-motion/forced-colors/Save-Data
fallbacks, and authored completion during a total model outage. Assert that:

- `/simulation` is absent when the feature is disabled;
- Tactical never downloads Phaser;
- Action downloads Phaser only after the visitor selects it;
- Tone.js is absent until `SOUND ON`;
- free-text requests, prompts, and model responses never appear in stored test
  state, logs, rendered HTML, or artifacts; and
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

Normal PRs run Validate, Gitleaks, CodeQL, and path-classified Browser Quality.
Documentation-only PRs may skip the expensive browser jobs. Copy-only PRs also
run the restricted copy lane described in [Copywriting](./copywriting.md).

Every staging or production release nevertheless requires four distinct,
successful runs for the exact 40-character SHA:

1. `Validate` from `.github/workflows/ci.yml`
2. `Gitleaks` from `.github/workflows/gitleaks.yml`
3. `CodeQL` from `.github/workflows/codeql.yml`
4. manually dispatched `Browser Quality` from `.github/workflows/browser-quality.yml`

The release planner verifies repository, workflow identity/path, active state,
event type where required, conclusion, URL, and commit SHA. See the environment
variables and guarded artifact flow in [Production release](./operations/release.md).
