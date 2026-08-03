# Repository Map

Use paths below relative to the repository root.

## Runtime and Route Ownership

- `app/`: Next/Vinext routes and server-rendered public pages.
- `components/`: interactive public UI. Keep meaningful content in semantic HTML before enhancement.
- `app/studio/`: owner interface. It is operational UI, not a public design playground.
- `app/api/studio/**`: canonical owner read/write APIs.
- `app/api/connectors/**`: public connector reads, OAuth callbacks, and retained 308 compatibility shims. Do not add owner mutations here.
- `lib/server/http/`: reusable authenticated request handlers. Prefer thin route files that delegate here.
- `lib/server/connectors/`: provider clients, credentials, snapshots, OAuth, public projections, and repository orchestration.
- `lib/server/strava-config.ts`: Strava's separate embed/configuration path; it is not a generic API-backed connector.
- `worker/index.ts`: Cloudflare Access verification, throttling, CSP, secure response headers, and scheduled retention.
- `drizzle/`: ordered D1 migrations. Existing migrations are immutable.
- `tests/`: content, backend/security, and rendered acceptance suites.

## Public Content Resolution

The checked-in sanitized bundle is the static base. At runtime, `lib/server/public-content.ts` may merge an allowlisted published D1 editorial snapshot through `lib/server/public-content-selector.ts`. Editorial overrides may change only approved ordering, wording, caveats, and visibility; they do not own IDs, relations, metric subjects, or raw HTML.

## UI Contract

- Use `frontend-design` as the only creative/design skill.
- Keep Work as one ruled, typographic Bodies of Work index with four editorial buckets and a semantic year calendar.
- Keep archive navigation two-dimensional and server rendered. Do not add Three.js, WebGL, a duplicate map, or a second archive.
- Preserve no-JavaScript content, keyboard operation, visible focus, reduced-motion final states, forced-colors behavior, and narrow-screen wrapping.
- Use Anime.js only for brief, cancellable enhancement of non-essential transitions. Do not animate LCP content or hide required information in motion.
- Keep third-party frames and provider artwork deferred until the relevant Play stream or consent step is activated.

## Known High-Risk Seams

- `scripts/build-content.mjs` is a thin facade; generator ownership lives in `scripts/content/*`. Content changes must identify the normalization, grouping, metrics, evidence, privacy, reporting, and output modules they affect and must refresh the checked-in attestation.
- `lib/server/connectors/repository.ts` is a public facade over the `repository-*` modules. Follow provider changes through contracts, credentials/OAuth, refresh locks, snapshots/public projectors, audit, and retention rather than adding behavior to the facade.
- Studio provider ownership lives in `app/studio/connectors/*`; the shared shell remains in `app/studio/ConnectorControls.tsx`. Play stream ownership lives in `components/play/*`, while Spotify groove, inspector, consent, and gallery behavior lives in `components/spotify/*`.
- Cross-module changes to provider state must keep Studio, public Play, exact runtime projectors, D1 persistence, privacy scans, and connector tests in sync.
- Status/date formatting and provider-state presentation are duplicated across public Play and Studio. Reuse an existing formatter where possible; do not create a third vocabulary.
- Several tests assert source structure with regular expressions. Retain those backstops, but add response- or behavior-level coverage before structural refactors.
- Worker middleware owns production security behavior. A successful local Vinext page alone is not release evidence.

## Editing Discipline

- Inspect the full affected data flow before editing a high-risk seam.
- Keep route files thin and validation centralized.
- Avoid direct `process.env` reads in runtime code; use `lib/server/runtime-env.ts` so Cloudflare bindings and local development remain consistent.
- Preserve legacy redirects unless the task explicitly includes a measured compatibility removal.
- Split large files only as a deliberate, tested refactor—not as incidental cleanup.
