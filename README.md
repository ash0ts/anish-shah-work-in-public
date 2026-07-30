# Anish Shah — Work in Public

An authored portfolio about applied AI products, education, open source,
technical storytelling, and community programs from 2021 onward.

## Experience

- `/` — a concise introduction, four Bodies of Work, and a cross-year Impact
  Ledger
- `/work` — 82 browsable WorkGroups, a Story × Time overview, and search across
  186 nested public forms
- `/work/[slug]` — one story page that keeps its appearances, recordings,
  translations, repositories, and references together
- `/play` — consent-aware MyAnimeList, Hardcover, Steam, and Strava streams
- `/about` — biography, current focus, trajectory, and operating principles
- `/sources` — archive accounting, claim context, counting rules, and the
  public evidence explorer
- `/studio` — owner-only editorial and connector controls

The homepage is deliberately two-dimensional: semantic HTML and CSS carry the
work index, while Anime.js adds brief, cancellable transitions. The public
runtime contains no 3D navigation, cinematic workspace, autoplay, or scroll
hijacking. Strava content remains blocked until explicit interaction.

## Canonical content

The four source CSV/Markdown files one directory above this project are
immutable migration inputs. Generate and verify the canonical bundles with:

```bash
node scripts/build-content.mjs
node scripts/build-content.mjs --check
```

The current public projection accounts for:

- 184 public-footprint source observations — not 184 unique works
- 85 impact source observations
- 82 WorkGroups
- 186 public forms nested beneath those stories
- 13 rounded public measures in four impact families
- 198 public evidence records

`content/public/anish-content.public.v1.json` is the only canonical content
bundle available to the application. The exact owner bundle is generated under
`content/private/`, ignored by Git, and excluded from deployments.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` verifies canonical accounting and privacy, backend authorization and
encryption boundaries, the production build, public route rendering, and
deployed-artifact hygiene.

## Studio and connectors

Studio and every write API require both Sign in with ChatGPT and an exact email
match in `OWNER_EMAILS`. Connector credentials are AES-256-GCM encrypted before
they enter D1 using `CONNECTOR_ENCRYPTION_KEY`.

MyAnimeList and Hardcover use 12-hour stale-while-revalidate snapshots and
preserve the last successful public result on provider failure. The Strava
surface accepts only an official public embed URL through
`NEXT_PUBLIC_STRAVA_EMBED_URL`.

Steam uses an owner-supplied Web API key and SteamID64 only from the server,
publishes bounded summaries of public game details, and keeps no more than two
sanitized snapshots. Configure the actual D1 storage country or countries in
`STEAM_DATA_STORAGE_COUNTRIES` before connecting it. If public game visibility
is removed, the public snapshots and prior sync history are purged;
disconnecting Steam deletes its encrypted credential, all remaining Steam
snapshots, and its Steam-specific sync and audit history. The public
[privacy page](./app/privacy/page.tsx) records retrieval, storage, retention,
and deletion behavior.

Follow the exact owner workflow in
[Play connections: owner setup](./docs/play-connections.md) and use
[.env.example](./.env.example) for local configuration. Never commit real
provider credentials or encryption keys.

## Deployment

This project is packaged and deployed through OpenAI Sites with the D1 binding
declared in `.openai/hosting.json`. Checked-in migrations live under `drizzle/`.
