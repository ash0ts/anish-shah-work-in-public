# Anish Shah — Work in Public

An owner-operated portfolio of applied AI products, education, open source,
technical storytelling, and community programs from 2021 onward.

## Public experience

- `/` — professional thesis, selected Bodies of Work, trajectory, and qualified impact
- `/work` — the complete, searchable WorkGroup archive
- `/work/[slug]` — one body of work with its public forms and evidence
- `/play` — My Room, 2001: a semantic six-object collection directory
- `/play/watch`, `/play/read`, `/play/listen`, `/play/collect`, `/play/play`, `/play/move` — one provider per direct route
- `/simulation` — a feature-gated public-model campaign with Action and semantic Tactical modes
- `/sources` — archive accounting, claims, methodology, and bibliography
- `/privacy` — privacy, connector, retention, and contact information
- `/studio` — owner-only editorial and connector operations

The public experience is server-rendered HTML first. The Work archive stays
two-dimensional. Three.js is isolated to the explicitly entered Play room, and
every collection remains reachable without WebGL or JavaScript.

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
[Meet Me simulation](./docs/architecture/meet-me-simulation.md).

## Common work

- Application changes: follow [Contributing](./CONTRIBUTING.md) and
  [Testing](./docs/testing.md).
- Copy changes: follow [Copywriting](./docs/copywriting.md) and edit only
  `content/copy/**/*.md`.
- Provider setup or recovery: use [Play connections](./docs/play-connections.md).
- Preview and staging work: use [Staging and PR previews](./docs/operations/staging-and-previews.md).
- Production release: use the sole [Production release runbook](./docs/operations/release.md).
- Rollback or incident response: use [Rollback](./docs/operations/rollback.md)
  and [Incidents](./docs/operations/incidents.md).

For a local real-model smoke test that never copies the provider key into the
repository, use `npm run dev:simulation:live -- --env-file <owner-only-file>`.
See [Testing and release gates](docs/testing.md) for the exact safety boundary
and verification label.

Live staging and production use separate Cloudflare AI Gateways, session keys,
rate-limit bindings, budgets, DLP/Guardrail policies, BYOK aliases, and owner
approval registers. Gateway prompt/response logging and response caching stay
off. Production remains disabled until its dedicated guarded release; no local
or preview credential or approval can be promoted into it.

## Trust boundary

Private source CSV/Markdown files and the exact owner bundle stay outside Git
and deployment. Public facts are regenerated through the content pipeline;
generated JSON is never hand-edited. Provider credentials are entered through
the protected Studio and encrypted before D1 storage.

`https://anish-shah-is.online` is the sole public production origin. The
private OpenAI Sites deployment remains a reference/recovery environment, not a
public rollback target.

This repository is private and intentionally has no open-source license.
