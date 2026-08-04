# Validation Matrix

Run from the repository root. Classify committed PR changes and local work together:

```bash
node .agents/skills/maintain-anish-site/scripts/check-change.mjs --plan --base origin/main
node .agents/skills/maintain-anish-site/scripts/check-change.mjs --run --base origin/main
```

## Path-to-Check Map

| Changed area | Required checks |
| --- | --- |
| `content/copy`, copy contracts/parser/voice/runtime | `copy:check`, `copy:voice`, `copy:diff`, `copy:audit`, `copy:test`, owner fact-check, typecheck, build, rendered and browser checks |
| canonical curation/presentation/generator/types | content verification, attestation, content tests, typecheck; rendered/privacy checks when public |
| public app/components/CSS/SEO | typecheck, lint, build, rendered tests; browser checks for responsive/interactive work |
| connectors, Studio, OAuth | typecheck, content/backend/security tests, exact public projector and provider-failure coverage; prove zero provider data calls from public reads/callbacks/saves/cron, one attempt per Studio refresh, and last-known-good preservation |
| Travel atlas, Travel Desk, geography, uploads/media, or room-globe integration | `travel:geography:check`, backend and rendered tests, clean local D1 migration, Travel security coverage, and full browser gate |
| Simulation campaign, session, Gateway, Action/Tactical, or shared audio | same-change Simulation regression coverage for server/privacy work; backend/security and rendered tests, bundle scan, exact runtime/privacy coverage, and full browser gate; verify authored fallback and gesture gating |
| Worker/auth/CSP/publication/security | backend/security tests, build, bundle scan, dependency audit |
| D1 migrations | clean local migration plus relevant backend/content tests; never edit an applied migration |
| README/docs | `npm run docs:check` plus link/command freshness review |
| `.agents` or skill policy | `npm run skill:validate` and `npm run test:maintenance-skill` |
| dependency/build/CI/cross-domain | full `npm run validate` and applicable browser gate |
| release scripts/contracts | ordinary `npm run validate`; production-candidate execution remains separate and authorization-gated |

The helper scans tracked and changed text for credentials, private sources, internal paths, and generated-content drift. It never deploys, migrates hosted state, rotates credentials, or mutates Git.

## CI Cost Boundaries

`PR Gate` classifies each pull request and runs only its bounded lane. Backend-only
connector changes do not build or start browsers unless the owner adds the
`preview` label. General UI, Room, Simulation, and Travel lanes build once and
download those exact bytes for their affected browser scope. Dependencies,
workflows, releases, and genuinely cross-domain changes use full validation.

Copy-only PR Gate covers parsing, copy tests, and typechecking. Its separate
trusted copy-preview workflow is required evidence for affected-route rendering
and focused screenshots: it checks out base-branch code and applies only the
validated plain-text deck. Do not replace that boundary with PR-authored scripts.

Code previews are owner-opt-in with the `preview` label; trusted copy previews
remain automatic. Gitleaks runs on every PR. CodeQL runs for relevant source,
security, dependency, workflow, and narrowly relevant security-test paths,
weekly, and for every release candidate. Pushes to `main` establish the merged
Validate/Gitleaks/CodeQL baseline; release branches use owner-dispatched exact-
SHA evidence instead of automatic full runs. Complete Browser Quality,
Lighthouse, and the two-worker/five-loop stability soak are manual exact-SHA
evidence, not ordinary PR work.

Disposable release runners use one-time labels and trusted `main` or
`release/<semver>` refs. They must require the exact current ref head, carry no
hosted secrets, reuse the Validate artifact, and be destroyed after one bounded
job. The optional corporate CA is never baked into an image or repository.

## Full Handoff

```bash
npm run validate
npm run validate:browser
```

`validate` covers copy/content attestations, lint, clean local D1 migrations, both repository skills, typechecking, content/backend tests, production build, bundle/privacy scans, rendered tests, and dependency policy. `validate:browser` covers Playwright, Axe, room behavior, responsive overflow, and Lighthouse.

Run `validate:release` only for a clean, pushed, approved production candidate after exact-SHA Validate, Gitleaks, CodeQL, and Browser Quality evidence exists. It must reuse and verify one immutable deployable artifact; it is not an ordinary development check.

## Manual Coverage

- Public UI/copy: affected routes at 320, 390, 768, 1024, 1440, and 1920px; long copy; owner verification for every fact-check field; claim qualification; 200–400% zoom; keyboard/focus; reduced motion; forced colors; metadata/JSON-LD; no JavaScript.
- My Room: zero connector reads on `/play`, one provider per object route, intent-gated R3F, drag/click discrimination, Back/Escape/focus restoration, static capability fallbacks.
- Travel: zero Travel reads on `/play`, semantic country/region/place parity, click-versus-drag behavior, no-JavaScript/WebGL fallbacks, planned/current publication limits, metadata stripping, active-snapshot media authorization, and immediate unpublish behavior.
- Simulation: Action/Tactical completion parity, authored fallback, optional-text privacy, bounded sessions/budgets, output rejection, and gesture-gated audio.
- Simulation incident: read-only Gateway logging/cache/DLP/Guardrails verification, sanitized containment evidence, authorized payload-deletion confirmation when needed, and fresh regression coverage before live mode returns.
- Studio/OAuth: logged out, non-owner, owner, origin/body guards, denial/expiry/replay/wrong owner, refresh/replacement/disconnect, sanitized errors, honest complete/already-running/not-due/rate-limited/failure states, and Strava save/Verify-only health checks.
- Environments: preview fixtures only, staging isolation/noindex, production exact host/Access, private Sites unchanged.
- Release: follow the canonical runbook's registry-derived required smoke set
  and distinguish automated evidence from manual inspection.

If private inputs, provider credentials, browser/Cloudflare access, or exact workflow evidence are unavailable, name the unverified step. Never weaken a gate to manufacture success.
