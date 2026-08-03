---
name: maintain-anish-site
description: Maintain, debug, extend, validate, or release the Anish Shah Work in Public site. Use for changes involving its Next/Vinext UI, canonical content and curation, WorkGroups and metrics, Play connectors, Studio and OAuth, D1 migrations, Cloudflare Access or Worker deployment, accessibility, SEO, privacy, security, or production verification. Enforces the repository's public/private content boundary, connector publication rules, local-production isolation, and validation matrix.
---

# Maintain Anish Site

Preserve the site's content, privacy, accessibility, connector, and release contracts while making the smallest change that satisfies the request.

## Workflow

1. Classify the request as diagnosis, UI, content, connector/Studio, storage, security, or release. Do not mutate files or external state for a diagnosis or review request.
2. Read the repository-root `AGENTS.md`, inspect `git status`, and preserve unrelated work.
3. Read only the applicable reference:
   - UI or repository architecture: [repository-map.md](references/repository-map.md). For visual or interaction changes, also use `frontend-design`.
   - Content or claims: [content-contract.md](references/content-contract.md) and the repository's `content/README.md`.
   - Connectors, Studio, security, storage, or deployment: [connectors-security-release.md](references/connectors-security-release.md).
   - Before handoff: [validation-matrix.md](references/validation-matrix.md).
4. Trace the authoritative source before editing. Do not patch generated output when a curation file, schema, migration, or server policy owns the behavior.
5. Implement the smallest coherent change. Add a behavioral regression test for every repaired invariant.
6. Run `node .agents/skills/maintain-anish-site/scripts/check-change.mjs --run`. Use `--full` for cross-domain, security, migration, dependency, or release changes.
7. Inspect relevant responsive, keyboard, no-JavaScript, reduced-motion, provider-failure, and privacy states.
8. Report changed behavior, validation run, remaining uncertainty, and any production action that still requires explicit authorization.

## Non-Negotiable Boundaries

- Never print, stage, deploy, or copy secrets, `.env*`, `.wrangler`, local D1 state, `content/private`, OAuth tokens, provider payloads, or internal evidence.
- The helper scans both tracked files and changed files for high-confidence token formats, literal credential assignments, machine-local paths, internal workspace URLs, and private evidence markers in public data. Replace examples with documented placeholders; never weaken the scanner to accommodate copied credentials.
- Never edit the four immutable source files or generated public JSON by hand. Preserve stable IDs, legacy aliases, explicit metric subjects, and public-projection validation.
- Put new owner mutations under `/api/studio/**`. Apply same-origin rejection, owner authorization, then bounded JSON parsing.
- Keep OAuth callbacks public only when protected by encrypted, owner-bound, expiring, single-use state.
- Do not assume Strava uses the generic connector repository.
- Do not transfer MyAnimeList, Spotify, or Discogs OAuth credentials through local promotion.
- Add a new D1 migration; never rewrite an applied migration.
- Do not deploy, migrate remote D1, rotate keys, weaken Access, or alter the private Sites reference/recovery environment unless the user explicitly requests that action.

## Helper Safety Contract

- `--plan` classifies the change and enforces guardrails without running application checks.
- `--run` executes only the checks selected from the changed paths.
- `--full` runs `validate` and `validate:browser`; it still never deploys, migrates production, rotates credentials, or mutates Git.
- Owner write routes, Access/authentication code, and OAuth code require a security or connector regression-test file in the same change.
- Responsive Play-stream changes require the browser quality gate. Release-related changes require `validate:release`, which validates prepared release metadata but performs no production mutation.
- Run `npm run test:maintenance-skill` after changing the helper or its policy. Do not add broad directory exemptions for tests, docs, or generated files.
