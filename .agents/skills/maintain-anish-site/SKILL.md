---
name: maintain-anish-site
description: Maintain, debug, extend, validate, stage, or release the Anish Shah Work in Public site. Use for application code, My Room 2001, canonical content, the copy deck, Play connectors, Studio, OAuth, D1 or KV, Cloudflare environments, accessibility, SEO, privacy, security, CI, documentation, and production verification. Enforces public/private data boundaries, environment isolation, exact-SHA release evidence, and risk-based validation.
---

# Maintain Anish Site

Make the smallest coherent change while preserving the site's content, copy, privacy, accessibility, connector, environment, and release contracts.

## Workflow

1. Read the repository-root `AGENTS.md`, inspect `git status`, and preserve unrelated work.
2. Classify the request as diagnosis, copy, canonical content, UI, room, connector/Studio, storage, security, CI/docs, staging, or production release. A review or diagnosis does not authorize writes or deployment.
3. Read only the applicable reference:
   - Architecture, UI, room, or repository ownership: [repository-map.md](references/repository-map.md). Also use `frontend-design` for visual, interaction, or hierarchy changes.
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
- My Room 2001 is the authoritative Play experience. Its six semantic routes and HTML foundations own navigation and content; the R3F room is an optional enhancement.
- Three.js/R3F may exist only under `components/play/room-3d/**`, load only after intent and capability checks, and never own provider data or accessibility semantics.
- Discogs uses OAuth 1.0a HMAC-SHA1 and a text-first, short-lived public catalog. Do not treat it as an OAuth 2 or artwork-gallery provider.

## Non-Negotiable Boundaries

- Never print, stage, deploy, or copy secrets, `.env*`, `.wrangler`, local D1, `content/private`, OAuth material, raw provider payloads, internal evidence, or machine-local paths.
- Never hand-edit the immutable source files, generated public JSON, generated copy module, content attestation, or migration report. Preserve stable IDs, aliases, explicit metric subjects, and public projector validation.
- New owner mutations live under `/api/studio/**` and require same-origin rejection, verified owner authorization, bounded body parsing, exact runtime validation, and sanitized no-store responses.
- OAuth callbacks may be public only with exact callback origins plus encrypted, owner-bound, expiring, single-use state and replay prevention.
- Never rewrite an applied D1 migration. Only the audited one-time flow may transfer reviewed Hardcover, Steam, and Strava setup from local to production; never move OAuth material, snapshots, D1 rows, KV envelopes, or encryption keys between environments.
- Do not deploy, migrate hosted D1, rotate keys, change Access, or mutate provider registrations unless the user explicitly requests that exact action.

## Environment Contract

- Local: loopback, isolated local D1, local secrets, ordinary development.
- PR preview: Access-protected, synthetic static fixtures, no D1/KV/provider calls/Studio/OAuth/secrets.
- Staging: Access-protected, isolated Worker/D1/KV/secrets/provider registrations; never a production-data clone.
- Production: `https://anish-shah-is.online`, Access-protected owner surfaces, exact-SHA guarded release.
- Private Sites deployment: reference/recovery only, never production rollback or public proxy.

## Helper Safety Contract

- `--plan` classifies paths and enforces guardrails without application checks.
- `--run` executes selected checks. `--full` runs `validate` and `validate:browser`.
- `--base <ref>` includes committed changes from that merge base through `HEAD`; use it for PR and freelancer review.
- Owner write, Access/auth, and OAuth code require matching security/connector regression tests.
- Copy changes require copy parsing, voice/audit, owner fact-check, diff, rendered, metadata, and browser checks. Skill and docs changes require their dedicated validators.
- Release-code edits select ordinary `npm run validate`. `npm run validate:release` is only for a clean, pushed, explicitly approved production candidate with exact-SHA workflow evidence.
- The helper never deploys, migrates hosted state, rotates credentials, or mutates Git.
