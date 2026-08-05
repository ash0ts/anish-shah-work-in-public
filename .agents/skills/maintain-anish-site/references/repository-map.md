# Repository Map

Paths are relative to the repository root.

This reference is the agent-facing ownership and risk map. The demonstrative,
human-readable architecture narrative lives in
`docs/architecture/codebase-tour.md`; update both when a subsystem boundary,
request path, durable store, or progressive-enhancement boundary changes.

## Runtime Ownership

- `app/`: Next/Vinext public routes and server-rendered foundations.
- `app/play/**`: My Room overview plus seven semantic object routes.
- `components/play/**`: object-screen shell and provider-specific Play UI.
- `components/play/room-3d/**`: intent-gated Room and Pocket Room R3F runtime.
- `components/play/travel/**`: Postcard Planet semantic atlas and the only full-globe R3F boundary.
- `app/simulation/**` and `components/simulation/**`: semantic campaign shell, Tactical mode, and the narrowly scoped Action Canvas bridge.
- `app/studio/**`: owner-only operational interface. Git-owned copy is shown read-only here.
- `app/api/studio/**`: canonical owner read/write APIs.
- `app/api/connectors/**`: public reads, exact OAuth callbacks, and retained compatibility redirects—not new owner mutations.
- `lib/server/http/**`: thin, reusable authenticated request handlers.
- `lib/server/connectors/**`: provider contracts, clients, credentials, OAuth, refresh locks, public projectors, snapshots, audit, and retention.
- `lib/server/strava-config.ts`: separate official-embed configuration, not the generic connector repository.
- `lib/server/travel/**`: Postcard Planet drafts, policy, public projection, versioned publication, retention, uploads, and media authorization. Public atlas and paginated trip projectors stay narrower than stored publication records.
- `app/studio/travel/**` and `app/api/studio/travel/**`: owner-only Travel Desk and writes. Exact GPS and original filenames remain browser-local intake suggestions and never enter public state.
- `lib/server/simulation/**`: bounded session, budget, approval, grounding, and model-gateway contracts.
- `worker/**`: host/tier enforcement, Cloudflare Access, CSP, headers, throttling, request correlation, and retention/cleanup maintenance. Cron must never synchronize provider collections.
- `drizzle/**`: ordered immutable D1 migrations.
- `tests/**`: content, copy, backend/security, rendered, environment, and browser acceptance.
- `docs/README.md`: documentation authority map. Every canonical documentation
  authority is listed there exactly once; support policy files are still
  scanned by `docs:check` without becoming competing authorities.
- `docs/operations/bootstrap.md`, `staging.md`, `previews.md`, and `release.md`:
  distinct hosted-operation authorities for one-time provisioning, live
  candidate validation, synthetic review environments, and production
  promotion respectively. Do not merge their procedures back together.

## Content and Copy Ownership

- `content/curation/**` and `content/presentation/**`: reviewed canonical grouping and metric presentation inputs.
- `content/public/**`: generated, sanitized deployable artifacts; never hand-edit.
- `content/copy/pages/**`: Git-owned page presentation prose.
- `content/copy/work-groups/**`: Git-owned WorkGroup display/short titles, summaries, and role summaries, each bound to a stable sanitized ID.
- `scripts/lib/copy-deck.mjs`: strict plain-text parser and generator.
- `lib/copy.ts`, `lib/copy-contract.ts`, `lib/copy-ownership.ts`, `lib/copy-voice-contract.ts`: typed registry, runtime ownership, and deterministic public-voice policy.
- `scripts/copy-voice-check.mjs` and `scripts/lib/copy-voice.mjs`: copy voice and claim-qualification audit tooling.
- Generated copy modules are ignored build products. Copywriters commit only the source Markdown deck.

Runtime precedence is: sanitized canonical facts and structure, then published D1 visibility/order/caveats/metric wording, then declared Git-owned copy fields. D1 values shadowed by the deck are reported for owner review rather than silently becoming authoritative.

## Public UI and Language Contract

- `frontend-design` is the only creative skill and is required when public-language work changes layout, interaction, or hierarchy.
- Work stays a two-dimensional, server-rendered semantic color calendar; copy changes do not authorize a second archive or WebGL navigation.
- Public copy uses a first-person technical voice and the sequence outcome → mechanism → proof → meaning. Keep one claim per sentence and its qualifier adjacent.
- The copy deck owns only allowlisted presentation prose. Sanitized canonical facts and D1 publication state remain authoritative for identity, metrics, evidence, visibility, ordering, and caveats.
- Keep motion brief, interruptible, and nonessential. Do not use copy or presentation work to introduce film, autoplay, or scroll capture.

## My Room Contract

- `/play` performs zero connector or Travel reads and offers a semantic seven-object directory.
- `/play/watch`, `/play/read`, `/play/listen`, `/play/collect`, `/play/play`, and
  `/play/move` load only their associated provider; `/play/travel` loads only
  the sanitized Travel publication.
- Canvas is decorative and `aria-hidden`; semantic controls, direct routes, browser Back, Escape, and focus restoration are authoritative.
- Do not import Three/R3F into Worker, Studio, Home, Work, Sources, initial Play, connector modules, or Simulation.
- Preserve poster/static fallback for narrow screens, coarse pointers, reduced motion, forced colors, Save-Data, zoom, WebGL failure, and context loss.

## High-Risk Seams

- `scripts/build-content.mjs` orchestrates `scripts/content/**`; refresh the public attestation whenever generator, curation, or output changes.
- Connector repository facades span credentials/OAuth, public projectors, snapshots, locks, audit, retention, Studio, Play, and privacy tests. Change the whole contract, not one facade.
- Every connector collection refresh is an explicit owner Studio action. Public reads, callbacks, credential saves, and cron never call provider data APIs; a failed refresh preserves the active last-known-good snapshot.
- Discogs uses OAuth 1.0a, bounded sequential pagination, a standard six-hour public cutoff, and no provider artwork. Older stale display is allowed only by a current owner-only recorded provider permission.
- Travel is not a connector. It uses isolated D1/KV/R2 state, whole-trip atomic publication, publication-aware media delivery, and the `TRAVEL_ATLAS_MODE` gate. Preview uses synthetic fixtures and never receives R2.
- Simulation keeps model prose separate from trusted fact cards, never stores free text or model prompts/responses, and must retain an authored fallback when AI is unavailable.
- Hosted tier configuration is exact and mutually exclusive. Fixture mode is preview-only; staging and production must fail closed on missing or inconsistent bindings.
- Worker middleware—not a successful local page—owns production security behavior.

## Editing Discipline

- Keep route files thin, runtime validation centralized, and public projectors exact.
- Use `lib/server/runtime-env.ts` instead of direct runtime `process.env` access.
- Preserve semantic HTML, visible focus, no-JavaScript content, reduced-motion final states, forced-colors support, and long-copy wrapping.
- Preserve redirects unless measured compatibility removal is explicitly in scope.
- Split large files only as a deliberate tested refactor, not incidental cleanup.
