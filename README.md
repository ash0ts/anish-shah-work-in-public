# Anish Shah — Work in Public

An authored portfolio of applied AI products, education, open source,
technical storytelling, and community programs from 2021 onward.

## What is here

- `/` — technical focus, career arc, Bodies of Work, and qualified impact
- `/work` — 82 WorkGroups connecting 186 searchable public forms
- `/work/[slug]` — one story with its appearances, artifacts, and evidence
- `/play` — consent-aware MyAnimeList, Hardcover, Spotify, Steam, and Strava
- `/sources` — archive accounting, claim context, and public bibliography
- `/studio` — owner-only editorial and connector controls

The public site is semantic HTML first. Anime.js adds bounded enhancement;
there is no Three.js archive navigation, autoplay, or scroll hijacking.

## Start locally

Use Node `24.18.0` and npm `11.6.2`.

```bash
npm install --global npm@11.6.2 --ignore-scripts
npm ci
cp .env.example .env.local
# Set matching OWNER_EMAILS and LOCAL_OWNER_EMAIL values, then generate the two
# independent local-only values described in .env.example:
# CONNECTOR_ENCRYPTION_KEY and RATE_LIMIT_SALT.
npm run local:security:setup
npm run dev:studio
```

Open `http://localhost:3000/studio`. Local credentials, snapshots, and D1 data
remain under the ignored local environment. `LOCAL_OWNER_EMAIL` is rejected in
hosted environments.

## Validate

```bash
npm run validate
```

That command verifies the checked-in public-content attestation, lint,
typechecking, a clean local D1 migration, content/privacy behavior, backend
authorization, the production build, rendered routes, release-bundle hygiene,
and dependency gates.

`npm run validate:browser` builds the Worker, checks public routes in Chromium
at six viewport widths, runs Axe against key pages, and enforces mobile
Lighthouse scores of at least 90 with CLS at most 0.1. Reports remain local and
are never uploaded to a third party.

## Content boundary

The four private CSV/Markdown source files live one directory above this
project. They are immutable migration inputs and never enter Git or deployment
artifacts. The application reads only
`content/public/anish-content.public.v1.json`; its safe checksums and counts live
beside it in `anish-content.public.v1.attestation.json`.

For an owner content release:

```bash
node scripts/build-content.mjs
npm run verify:content
npm run content:attest:write
npm run content:attest
```

The ignored exact owner bundle remains under `content/private/`. See
[the content architecture](./docs/architecture/content-and-state.md).

## Production

Public production is an owner-controlled Cloudflare Worker with D1 as the
publication authority and a versioned Workers KV last-known-good cache.
`https://anish-shah-is.online` is the sole public origin; the generated release
configuration pins that Custom Domain and disables the `workers.dev` hostname.
Cloudflare Access plus an exact application allowlist protects `/studio/**` and
`/api/studio/**`. The private OpenAI Sites deployment is a recovery/reference
environment, not a public rollback target.

Release only a clean, pushed, validated commit. The release gate binds the
exact `dist/client` and `dist/server` bytes with a deterministic manifest,
alongside three exact-commit CI runs. Capture a D1 Time Travel bookmark and both
Worker version IDs, then record the result under `releases/`.
Follow the [release runbook](./docs/operations/release.md) and
[rollback runbook](./docs/operations/rollback.md). No command in this repository
automatically weakens Access or copies production credentials.

## Documentation

- [Architecture and trust boundaries](./docs/architecture/overview.md)
- [Content and state](./docs/architecture/content-and-state.md)
- [Testing](./docs/testing.md)
- [Play connector setup](./docs/play-connections.md)
- [Release](./docs/operations/release.md)
- [Rollback and D1 restore](./docs/operations/rollback.md)
- [Incidents and credential recovery](./docs/operations/incidents.md)
- [Observability](./docs/operations/observability.md)
- [Contributing](./CONTRIBUTING.md) and [security reporting](./SECURITY.md)

The repository is private and intentionally has no open-source license.
