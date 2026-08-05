# Anish Shah — Work in Public

An owner-operated portfolio of applied AI systems, technical education, open
source, research implementations, and public programs from 2021 onward.

## Public experience

- `/`, `/work`, and `/work/[slug]` present the professional thesis and the
  complete Bodies of Work archive.
- `/play` is [My Room, 2001](./docs/architecture/my-room-2001.md): a semantic
  seven-object directory. Its six connector routes and `/play/travel` remain
  reachable without WebGL or JavaScript.
- `/simulation` is a feature-gated public-model doorway or the full
  Action/Tactical campaign.
- `/sources`, `/privacy`, and owner-only `/studio` expose methodology,
  privacy terms, and protected operations.

The public experience is server-rendered HTML first. The Work archive stays
two-dimensional. Three.js is confined to the explicitly entered Play room and
Postcard Planet globe.

## Start here

Use Node `24.18.0` and npm `11.6.2`. Follow [Testing](./docs/testing.md) for
the complete fresh-clone, local-security, database, browser, and validation
workflow. [Contributing](./CONTRIBUTING.md) defines the review path.

```bash
npm ci
npm run setup:local
# Replace the OWNER_EMAILS and LOCAL_OWNER_EMAIL placeholders in .env.local.
npm run doctor
npm run dev:studio
```

## System in one minute

- Sanitized canonical facts and reviewed copy live in Git; D1 owns published
  state and encrypted connector configuration; KV is validated fallback state.
- Provider collections change only after an explicit owner Refresh in Studio.
  Public reads and scheduled maintenance do not synchronize provider data.
- Cloudflare Access, Worker JWT verification, and the exact owner allowlist
  protect Studio and owner mutations.
- Local, synthetic PR preview, isolated staging, and production never share
  durable data, credentials, encryption material, or publication approval.
- Production fails closed when D1 and KV cannot supply a valid publication.

Use the [documentation authority map](./docs/README.md) instead of relying on
duplicated setup or operational snippets. Common authorities include:

- [Architecture](./docs/architecture/overview.md) and
  [content/state ownership](./docs/architecture/content-and-state.md)
- [Play provider connections](./docs/play-connections.md) and
  [Postcard Planet](./docs/travel-atlas.md)
- [Copywriting](./docs/copywriting.md) and
  [experience audio](./docs/audio-production.md)
- [Hosted bootstrap](./docs/operations/bootstrap.md),
  [staging](./docs/operations/staging.md),
  [PR previews](./docs/operations/previews.md), and
  [production release](./docs/operations/release.md)
- [Security reporting and threat model](./SECURITY.md)

## Trust boundary

Private source CSV/Markdown files and the exact owner bundle stay outside Git
and deployment. `content/public/anish-content.public.v1.json` is generated;
never hand-edit it. Provider credentials enter through protected Studio and are
encrypted before D1 storage. Local, preview, staging, and production state stay
isolated.

`https://anish-shah-is.online` is the sole public production origin. The
private OpenAI Sites deployment remains a reference/recovery environment, not a
public rollback target.

This repository is private and intentionally has no open-source license.
