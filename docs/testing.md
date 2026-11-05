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
when absent, fills only missing or blank `CONNECTOR_ENCRYPTION_KEY`,
`RATE_LIMIT_SALT`, and `SIMULATION_SESSION_HMAC_KEY` values with independent
random 32-byte values, writes atomically, and applies mode `0600`. It never
prints or replaces a value. It refuses CI, hosted origins, non-loopback
configuration, and duplicate keys.

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

Local 4N1SH uses the owner-only conversation preview. Run `npm run setup:local`
and `npm run db:local:migrate`, then `npm run dev:simulation`. Archive search
works without a provider key. Studio owns **Save Gemini key → Test connection →
Enable owner preview**. Never put a Gemini key in fixtures, environment files,
or CI. Setup generates the separate `SIMULATION_SESSION_HMAC_KEY`.

See [the conversation architecture](./architecture/meet-me-simulation.md) for
limits, collection permissions, and the distinction between mocked transport
coverage and a real account connection test. Production remains disabled;
synthetic previews make no model requests.

Before release, collect Validate, Gitleaks, CodeQL, and Browser Quality evidence
for the same full 40-character pushed SHA. Four manually dispatched workflows
are the default. If hosted minutes or artifact storage are unavailable, the
documented owner-local mode runs the first, second, and fourth gates directly
against one immutable build while CodeQL remains a pinned exact-SHA action on a
disposable owner runner. Browser stability is a separate, optional exhaustive
interaction soak and is not release-plan evidence.

## Exact-SHA owner evidence capacity

Ordinary PRs use the path-classified `PR Gate`; full exact-SHA release evidence
is owner-dispatched. Follow the sole
[runner and local-evidence guide](../.github/runner/README.md) for the normal
disposable workflow path and the explicit artifact-capacity fallback, including
the exact local command, safe receipt, CodeQL container, corporate-CA handling,
and cleanup. Neither path waives an assertion, immutable-artifact check,
browser gate, security scan, or release-plan check.

## Private-source regeneration

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
all Lighthouse routes, and gives its child processes a combined 14.25-minute
hard budget. WebKit completes before Lighthouse starts so two browser/server
pairs never compete during startup. This prevents a SwiftShader-heavy room
process from starving a newly created no-JavaScript Chromium renderer on a
bounded release runner without weakening or retrying the assertion.
Lighthouse collects three samples per route and applies the 0.90 performance
budget to the median-performance run; all reports are retained. This is
benchmark sampling, not a retry that converts a functional failure into a pass.
Twenty-fold click/drag loops, all-object Pocket stress, performance-downgrade
stress, and room-review captures belong to the separate manual stability soak.

The local browser harness uses the pinned `wrangler-e2e` alias only. Production
build and deployment continue using the repository’s production Wrangler
version. The browser pin includes upstream ProxyWorker recovery for a lost
local connection; the older pin could terminate the entire server after an
unread request body. Keep rejected-body and subsequent-navigation assertions:
do not hide failures with a server restart or functional-test retry. See
[the upstream proxy investigation](https://github.com/cloudflare/workers-sdk/issues/15203)
(last verified 2026-10-22). Browser jobs wait for semantic room readiness with a 15-second SLO and
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

The pinned Vinext 0.0.50 entry generator reads a stale `searchParamsObject`
property during page preflight; the collector returns `pageSearchParams`.
`build/vinext-page-query-compat.ts` corrects that single generated virtual-entry
access so preflight, metadata, and rendering see the same query. It fails closed
if the upstream expression changes. Review and remove the shim when upgrading
Vinext; never patch installed packages or deployable output. The Travel review
fixtures exercise non-default query selection through real HTTP requests.

Conversation coverage checks sourced questions, discoveries, still presentation,
no-JavaScript links, reduced motion, forced colors, and responsive overflow.
Security tests cover encryption, replay, revisions, budgets, expiry, invalid IDs,
provider failure, and prompt bounds. Questions and provider responses must not
enter stored state, logs, or artifacts.

```bash
node --test tests/conversation-security.test.mjs tests/conversation-ui.test.mjs
npm run browser:simulation:existing
```

Live Gemini remains owner-only. A synthetic connection test is not public
audience/region/privacy approval and never activates production.

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

Every staging or production release nevertheless requires four successful
logical gates for the exact 40-character SHA:

1. Validate
2. Gitleaks
3. CodeQL
4. Browser Quality

Normally, each is the matching active GitHub workflow and Browser Quality is
manually dispatched; isolated staging keeps that four-workflow contract. The
production release planner verifies repository, workflow
identity/path, active state, event type where required, conclusion, URL, and
commit SHA. When production is blocked specifically by hosted minutes or
artifact storage, its explicitly confirmed owner-local mode supplies Validate,
Gitleaks, and Browser Quality through one safe, mode-`0600`, self-digested
receipt over the same immutable artifact. CodeQL remains the active GitHub
workflow on a disposable AMD64 owner runner. The production planner verifies
the receipt, artifact, trusted pushed ref, and CodeQL URL and rejects mixed or
invented evidence. See the environment variables and guarded artifact flow in
[Production release](./operations/release.md).
