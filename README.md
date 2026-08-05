# Anish Shah — Work in Public

An owner-operated portfolio of applied AI systems, technical education, open
source, research implementations, and public programs from 2021 onward.

## Public experience

- `/` — professional thesis, selected lines of work, and qualified impact
- `/work` — the complete, searchable WorkGroup archive
- `/work/[slug]` — one body of work with its public forms and evidence
- `/play` — My Room, 2001: a semantic seven-object collection and travel directory
- `/play/watch`, `/play/read`, `/play/listen`, `/play/collect`, `/play/play`, `/play/move` — one provider per direct route
- `/play/travel` and `/play/travel/trips/[slug]` — Postcard Planet and canonical trip stories
- `/simulation` — a feature-gated public-model doorway or the full Action/Tactical campaign
- `/sources` — archive accounting, claims, methodology, and bibliography
- `/privacy` — privacy, connector, retention, and contact information
- `/studio` — owner-only editorial and connector operations

The public experience is server-rendered HTML first. The Work archive stays
two-dimensional. Three.js is confined to the explicitly entered Play room and
Postcard Planet globe, and every collection and trip remains reachable without
WebGL or JavaScript.

## Start here

Use Node `24.18.0` and npm `11.6.2`. The complete fresh-clone, local-security,
database, browser, and validation workflow lives in [Testing](./docs/testing.md).
The short path is:

```bash
npm ci
npm run setup:local
# Replace the OWNER_EMAILS and LOCAL_OWNER_EMAIL placeholders in .env.local.
npm run doctor
npm run dev:studio
```

Do not invent local secrets or hosted settings by hand when the setup command
can create them safely. Never copy local credentials, D1 data, or encryption
material to staging or production.

## Architecture in one minute

- `content/public/` contains the sanitized canonical facts and structure.
- `content/copy/` contains reviewed, Git-owned presentation wording.
- D1 controls published visibility, ordering, caveats, metric wording, encrypted
  connector credentials, and bounded provider snapshots.
- Provider collections synchronize only when the owner selects Refresh in
  Studio. Public reads and scheduled maintenance never call provider data APIs;
  a failed refresh leaves the accepted snapshot unchanged.
- Workers KV holds only a validated last-known-good public publication.
- Cloudflare Access plus Worker JWT validation and the exact owner allowlist
  protect Studio and owner writes.
- Production fails closed when D1 and KV cannot provide a valid publication.
- Local, synthetic PR preview, live staging, and production never share durable
  connector or database state.

See [Architecture](./docs/architecture/overview.md),
[Content and state](./docs/architecture/content-and-state.md), and
[My Room, 2001](./docs/architecture/my-room-2001.md). The optional campaign's
session, AI Gateway, privacy, and authored-fallback boundaries are documented in
[Meet Me simulation](./docs/architecture/meet-me-simulation.md). Travel data,
media, publication, and globe boundaries are documented in
[Postcard Planet](./docs/travel-atlas.md).

## Common work

- Application changes: follow [Contributing](./CONTRIBUTING.md) and
  [Testing](./docs/testing.md).
- Copy changes: follow [Copywriting](./docs/copywriting.md) and edit only
  `content/copy/**/*.md`.
- Provider setup or recovery: use [Play connections](./docs/play-connections.md).
- Travel authoring and media: use [Postcard Planet](./docs/travel-atlas.md).
- Audio cues and replacement assets: use [Experience audio](./docs/audio-production.md).
- Preview and staging work: use [Staging and PR previews](./docs/operations/staging-and-previews.md).
- Production release: use the sole [Production release runbook](./docs/operations/release.md).
- Rollback or incident response: use [Rollback](./docs/operations/rollback.md)
  and [Incidents](./docs/operations/incidents.md).
- Request tracing and health signals: use [Operational observability](./docs/operations/observability.md).

Release candidates are cut from `release/<semver>`, versioned with immutable
prerelease tags such as `v2.0.0-rc.1`, and deployed first to
`https://staging.anish-shah-is.online`. Staging is Access-protected, isolated
from production state, and globally noindexed. The draft release PR remains
open until the exact candidate passes the four exact-SHA workflows, migration
upgrade tests, staging checkpoint, browser matrix, and owner acceptance. See
the staging and release runbooks for the guarded commands; ordinary development
commands never deploy.

For a local real-model smoke test that never copies the provider key into the
repository, use `npm run dev:simulation:live -- --env-file <owner-only-file>`.
See [Testing and release gates](docs/testing.md) for the exact safety boundary
and verification label.

Live campaign releases in staging and production use separate Cloudflare AI
Gateways, session keys, rate-limit bindings, budgets, DLP/Guardrail policies,
BYOK aliases, and owner approval registers. Gateway prompt/response logging and
response caching stay off. The public `coming-soon` doorway runs none of that
campaign infrastructure: it creates no session, reads no dossier, calls no
model, stays out of the sitemap, and is noindexed. No local or preview
credential or approval can be promoted into a hosted tier.

## Trust boundary

Private source CSV/Markdown files and the exact owner bundle stay outside Git
and deployment. Public facts are regenerated through the content pipeline;
generated JSON is never hand-edited. Provider credentials are entered through
the protected Studio and encrypted before D1 storage.

`https://anish-shah-is.online` is the sole public production origin. The
private OpenAI Sites deployment remains a reference/recovery environment, not a
public rollback target.

This repository is private and intentionally has no open-source license.
