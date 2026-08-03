# Validation Matrix

Run commands from the repository root. Start with the smallest relevant checks, then expand for cross-cutting risk.

## Path-to-Check Map

| Changed area | Required checks |
| --- | --- |
| `content/curation`, `content/presentation`, `scripts/build-content.mjs`, content types/selectors | `npm run verify:content`, `npm run test:content`, `npm run typecheck` |
| `app`, `components`, route CSS, SEO or metadata | `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:rendered` |
| `lib/server/connectors`, connector APIs, Studio connector controls | `npm run typecheck`, `npm run test:content`, `npm run test:backend`, relevant rendered tests |
| `worker`, auth, CSP, request security, public projection | `npm run typecheck`, `npm run test:backend`, `npm run build`, `npm run bundle:scan`, `npm run security:audit` |
| release scripts/contracts, CodeQL/audit/bundle/browser gates, deployable manifest | `npm run validate:release` with documented release metadata; never deploy from the helper |
| `drizzle` or D1 repository changes | relevant backend/content tests plus the full gate; apply locally before any authorized remote migration |
| dependencies, build configuration, CI, or cross-domain changes | full gate |
| maintenance helper or repository skill policy | `npm run test:maintenance-skill` plus skill-creator `quick_validate.py` |

Use the bundled helper to classify changed paths:

```bash
node .agents/skills/maintain-anish-site/scripts/check-change.mjs --plan
node .agents/skills/maintain-anish-site/scripts/check-change.mjs --run
```

The helper never deploys or migrates remote state.
It scans tracked and changed text for high-confidence secret/private-source leaks;
placeholder examples must use the documented `<value>`, `${VALUE}`, `example`,
or clearly synthetic test forms. Owner write/auth/OAuth changes without a matching
security regression-test path fail classification. Responsive Spotify work selects
the browser gate, and release work selects `validate:release` without deploying.

## Full Gate

Run for security, migration, dependency, release, or cross-domain work:

```bash
npm run validate
npm run validate:browser
```

`validate` includes the public attestation, lint, a clean local D1 migration,
typechecking, content/backend tests, production build, bundle scan, rendered
tests, and the dependency gate. `validate:browser` adds Playwright, Axe, and
direct Lighthouse checks. Use `validate:release` only with the documented
production metadata after the exact commit is clean, pushed, and approved for
release. It performs a final build and bundle scan, then writes and verifies the
ignored deterministic manifest for every `dist/client` and `dist/server` file.

## Manual Checks by Surface

- Public UI: inspect 320, 390, 768, 1024, 1440, and 1920px; 200–400% zoom; text spacing; keyboard; focus; reduced motion; forced colors; long titles; missing imagery; and no-JavaScript content.
- Work and Sources: verify filters/search preserve canonical links, result counts are announced, and no duplicate index or inherited outcome appears.
- Play: activate one stream at a time; test unavailable, stale, provider failure, consent, gallery pagination, missing artwork, and focus restoration.
- Studio: test unauthenticated, authenticated non-owner, owner, same-origin rejection, oversized/malformed body, replacement, refresh, disconnect, and audited publication.
- OAuth: test exact callbacks, denial, expiry, replay, wrong owner, token rotation, 401 retry, invalid grant, 403, 429, and sanitized redirects.
- Release: verify anonymous public access and fail-closed Studio/API behavior from a logged-out browser.

## Handoff Evidence

Report the exact commands run and their result. Distinguish automated checks from manual inspection. If owner-held source inputs, provider credentials, Cloudflare authentication, or production access are unavailable, state the unverified step instead of weakening or silently skipping it.
