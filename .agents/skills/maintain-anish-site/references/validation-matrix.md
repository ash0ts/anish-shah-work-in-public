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
| connectors, Studio, OAuth | typecheck, content/backend/security tests, exact public projector and provider-failure coverage |
| Worker/auth/CSP/publication/security | backend/security tests, build, bundle scan, dependency audit |
| D1 migrations | clean local migration plus relevant backend/content tests; never edit an applied migration |
| README/docs | `npm run docs:check` plus link/command freshness review |
| `.agents` or skill policy | `npm run skill:validate` and `npm run test:maintenance-skill` |
| dependency/build/CI/cross-domain | full `npm run validate` and applicable browser gate |
| release scripts/contracts | ordinary `npm run validate`; production-candidate execution remains separate and authorization-gated |

The helper scans tracked and changed text for credentials, private sources, internal paths, and generated-content drift. It never deploys, migrates hosted state, rotates credentials, or mutates Git.

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
- Studio/OAuth: logged out, non-owner, owner, origin/body guards, denial/expiry/replay/wrong owner, refresh/replacement/disconnect, sanitized errors.
- Environments: preview fixtures only, staging isolation/noindex, production exact host/Access, private Sites unchanged.
- Release: follow the canonical runbook's thirteen smoke checks and distinguish automated evidence from manual inspection.

If private inputs, provider credentials, browser/Cloudflare access, or exact workflow evidence are unavailable, name the unverified step. Never weaken a gate to manufacture success.
