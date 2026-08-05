---
name: maintain-anish-site
description: Maintain, debug, extend, validate, stage, or release the Anish Shah Work in Public site. Use for application code, My Room and Pocket Room, Postcard Planet Travel, the 4N1SH Simulation, canonical content, the copy deck, Play connectors, Studio, OAuth, D1, KV, R2, Cloudflare Images or AI Gateway, accessibility, SEO, privacy, security, CI, documentation, and production verification. Enforces public/private data boundaries, environment isolation, exact-SHA release evidence, and risk-based validation.
---

# Maintain Anish Site

Make the smallest coherent change while preserving the site's content, copy, privacy, accessibility, connector, environment, and release contracts.

## Workflow

1. Read the repository-root `AGENTS.md`, inspect `git status`, and preserve unrelated work.
2. Classify the request as diagnosis, copy, canonical content, UI, room, connector/Studio, storage, security, CI/docs, staging, or production release. A review or diagnosis does not authorize writes or deployment.
3. Read only the applicable reference:
   - Architecture, UI, room, or repository ownership: [repository-map.md](references/repository-map.md). Also use `frontend-design` for visual, interaction, or hierarchy changes. Use `docs/architecture/codebase-tour.md` as the human-readable system tour; keep the skill reference focused on editing constraints and high-risk seams.
   - Canonical facts, claims, WorkGroups, or copy ownership: [content-contract.md](references/content-contract.md).
   - Public language: use `$edit-anish-site-copy` and its voice, surface, claims, protected-boundary, and pull-request references.
   - Connectors, OAuth, environments, security, staging, or production: [connectors-security-release.md](references/connectors-security-release.md).
   - Validation and handoff: [validation-matrix.md](references/validation-matrix.md).
4. Trace the authoritative source before editing. Never patch a generated file, D1 snapshot, or client output when curation, the copy deck, a schema, a migration, or server policy owns it.
5. Implement the smallest change and add a behavior-level regression test for every repaired invariant.
6. Classify both committed and local changes:

   ```bash
   node .agents/skills/maintain-anish-site/scripts/check-change.mjs --plan --base origin/main
   node .agents/skills/maintain-anish-site/scripts/check-change.mjs --run --base origin/main
   ```

   Use `--full` for cross-domain, security, migration, dependency, or final handoff work.
7. Inspect relevant responsive, keyboard, no-JavaScript, reduced-motion, forced-colors, provider-failure, and privacy states.
8. Report changed behavior, exact validation run, remaining uncertainty, and any hosted mutation still requiring explicit authorization.

## Domain Ownership

- Canonical facts and structure come from immutable source inputs, reviewed curation, and the generated sanitized public bundle.
- Git-owned presentation prose comes from `content/copy/**`. For copy-only work, use `$edit-anish-site-copy`; never move metrics, evidence, privacy, provider policy, routes, or behavior into that deck.
- Published D1 state owns allowlisted visibility, ordering, caveats, and metric wording. `PUBLICATION_CACHE` KV is the validated last-known-good production fallback.
- My Room 2001 is the authoritative Play experience. Its dependency-free closed seven-object contract, semantic routes, and HTML foundations own navigation and content; desktop and Pocket R3F rooms are optional enhancements. There is no Classic mode.
- Derive routes, controls, focus targets, and smoke paths from the structural object contract. Keep screen imports, provider adapters, scene objects, and other executable maps literal, closed, and parity-tested.
- Three.js/R3F may exist only under `components/play/room-3d/**` and `components/play/travel/**`, load only after their own intent/capability boundaries, and never own provider data, Travel photos, navigation semantics, or accessibility content.
- The Simulation may use Phaser, XState, and game Canvas only under its scoped paths. Keep Action lazy, Tactical semantic, authored fallback complete, visitor text ephemeral, and every factual card server-owned.
- Tone/Web Audio is gesture-gated under `components/experience-audio/**`; missing audio is silent and never blocks interaction.
- Connector collection synchronization is owner-triggered only. Public reads,
  OAuth callbacks, credential saves, and scheduled maintenance must not fetch or
  mutate provider collection data; Studio's explicit Refresh action owns that
  boundary.
- Failed connector synchronization preserves the active last-known-good
  snapshot. Discogs uses OAuth 1.0a HMAC-SHA1 and normally retains its six-hour
  public cutoff; older stale display requires a current, owner-only recorded
  provider permission. Do not treat Discogs as an OAuth 2 or artwork-gallery
  provider.

## Non-Negotiable Boundaries

- Never print, stage, deploy, or copy secrets, `.env*`, `.wrangler`, local D1, `content/private`, OAuth material, raw provider payloads, internal evidence, or machine-local paths.
- The helper scans tracked and changed text for high-confidence token formats, literal credential assignments, machine-local paths, internal workspace URLs, and private evidence markers. Use documented placeholders; never weaken the scanner to accommodate copied credentials.
- Never hand-edit the immutable source files, generated public JSON, generated copy module, content attestation, or migration report. Preserve stable IDs, aliases, explicit metric subjects, and public projector validation.
- New owner mutations live under `/api/studio/**` and require same-origin rejection, verified owner authorization, bounded body parsing, exact runtime validation, and sanitized no-store responses.
- OAuth callbacks may be public only with exact callback origins plus encrypted, owner-bound, expiring, single-use state and replay prevention.
- Do not assume Strava uses the generic connector repository. Its remote embed
  health check runs only when the owner saves or explicitly verifies the Studio
  configuration; public reads never recheck Strava.
- Travel is an owner-authored publication, not a connector. Keep draft D1 state, versioned D1/KV publication, private tier-isolated R2 media, approximate geography, and the `TRAVEL_ATLAS_MODE` gate separate from provider state. Authorize public media against the active snapshot before any derivative-cache lookup.
- Travel may use R3F, first-party geography, shaders, and browser-local image analysis only inside the scoped paths declared by `AGENTS.md`; its Canvas never replaces the semantic atlas.
- Simulation uses bounded D1 sessions, budgets, provider approvals, and a tier-isolated Cloudflare AI Gateway. Disable prompt/response logging and response caching, preserve DLP/Guardrails and spend limits, and never persist raw visitor or model text.
- Never rewrite an applied D1 migration. Only the audited one-time flow may transfer reviewed Hardcover, Steam, and Strava setup from local to production; never move OAuth material, snapshots, D1 rows, KV envelopes, or encryption keys between environments.
- Do not deploy, migrate hosted D1, rotate keys, change Access, or mutate provider registrations unless the user explicitly requests that exact action.

## Environment Contract

- Local: loopback, isolated local D1, local secrets, ordinary development.
- PR preview: Access-protected, synthetic static fixtures, no D1/KV/R2/provider calls/Studio/OAuth/secrets.
- Staging: Access-protected, isolated Worker/D1/KV/R2/Images/Gateway/secrets/provider registrations; never a production-data clone and always globally noindexed.
- Production: `https://anish-shah-is.online`, Access-protected owner surfaces, production D1/KV/R2/Images/Gateway, and exact-SHA guarded release.
- Private Sites deployment: reference/recovery only, never production rollback or public proxy.

## Helper Safety Contract

- `--plan` classifies paths and enforces guardrails without application checks.
- `--run` executes affected-surface checks. `--full` runs `validate` and the
  bounded fail-fast release browser gate. The gate isolates Simulation fallback
  foundations before parallel WebGL-heavy coverage and serializes WebKit before
  Lighthouse, without functional-test retries. Lighthouse budgets use the
  retained median of three benchmark samples per route.
  Exhaustive 20-fold interaction stress
  and visual capture belong to the separate manual stability workflow.
- `--base <ref>` includes committed changes from that merge base through `HEAD`; use it for PR and freelancer review.
- Owner write, Access/auth, and OAuth code require matching security/connector regression tests. Connector changes must prove public reads and cron make zero provider data-API calls, one Studio Refresh makes at most one attempt, and every failed attempt preserves the active snapshot.
- Travel owner APIs require `tests/travel-security.test.mjs`; Travel schema, geography, or media work requires its focused checks, a clean local migration, and the browser gate.
- Simulation APIs, persistence, campaign, Gateway, or provider-approval work requires focused Simulation security, migration, UI, privacy, and browser checks. Preserve both Action and Tactical completion plus authored outage fallback.
- Room registry changes require seven-key parity, zero overview data reads, direct-route source isolation, desktop/Pocket input tests, and disabled-feature reachability tests.
- Copy changes require copy parsing, voice/audit, owner fact-check, diff, rendered, metadata, and browser checks. Skill and docs changes require their dedicated validators.
- Documentation changes must preserve the authority map in `docs/README.md`.
  Run `npm run docs:check`; when architecture ownership changes, update both
  `docs/architecture/codebase-tour.md` and the repository map in this skill.
- Release-code edits select ordinary `npm run validate`. A clean pushed `release/<semver>` candidate may use the guarded staging workflow with all four exact-SHA workflow URLs. `npm run validate:release` and production mutation remain separately authorized.
- The helper never deploys, migrates hosted state, rotates credentials, or mutates Git.
