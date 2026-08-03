# Anish Shah — Work in Public

An authored portfolio about applied AI products, education, open source,
technical storytelling, and community programs from 2021 onward.

## Experience

- `/` — identity, current technical focus, a compact career arc, four Bodies
  of Work, and three qualified impact stories
- `/work` — a semantic four-line 2021–2026 calendar heatmap, four unpaginated
  body folds containing all 82 WorkGroups once, and search across 186 nested
  public forms
- `/work/[slug]` — one story page that keeps its appearances, recordings,
  translations, repositories, and references together
- `/play` — consent-aware MyAnimeList, Hardcover, Spotify, Steam, and Strava streams
- `/sources` — archive accounting, claim context, counting rules, and the
  public evidence explorer
- `/studio` — owner-only editorial and connector controls

Legacy `/about` links permanently redirect to the profile section on `/`.

The homepage and Work archive are deliberately two-dimensional: semantic HTML
and CSS carry the work index and impact small multiples, while Anime.js adds
brief, cancellable transitions. Work’s server-rendered calendar uses one color
per line and shade for density, keeps exact work and public-form counts in
every populated cell, and filters the four body folds when a visitor chooses a
year. The public runtime contains no Three.js, 3D navigation, cinematic
workspace, autoplay, or scroll hijacking. Strava content remains blocked until
explicit interaction.

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

Requires Node.js `>=24.0.0`.

```bash
npm install
npm run dev:studio
```

`dev:studio` applies pending migrations to the project-local D1 sandbox under
`.wrangler/state`, then starts the development site on strict
`localhost:3000`. Its migration wrapper always uses Wrangler’s local mode and
cannot target production. To open the protected Studio locally, create an
ignored `.env.local` from
[.env.example](./.env.example), set the same email in `OWNER_EMAILS` and
`LOCAL_OWNER_EMAIL`, and generate a local-only
`CONNECTOR_ENCRYPTION_KEY`. Then visit
`http://localhost:3000/studio`. The local identity fallback is rejected outside
development and outside localhost.

Local connector tests use real provider requests but write credentials,
snapshots, sync history, and editorial changes only to the local D1 sandbox.
Deploy code and non-secret configuration separately. After deployment, the
owner may use Studio’s single-use transfer code to send only the encrypted
Hardcover, Steam, and Strava setup to the production origin for review and
validation. Snapshots and the local encryption key never transfer;
MyAnimeList and Spotify always require production OAuth. Never copy local D1 state or
replace the production encryption key.

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

On the owner-controlled public Worker, Studio and every `/api/studio/**` route
require a cryptographically verified Cloudflare Access session plus an exact
email match in `OWNER_EMAILS`. Connector credentials are AES-256-GCM encrypted
before they enter D1 using `CONNECTOR_ENCRYPTION_KEY`. The private Sites
rollback retains its existing Sign in with ChatGPT access policy.

`LOCAL_OWNER_EMAIL` exists only to make the isolated localhost Studio testable
and must never be configured in either hosted environment.

MyAnimeList uses a complete owner-only authorization-code flow. Studio accepts
the application client ID and secret, performs OAuth with a single-use
owner-bound PKCE transaction, encrypts the resulting access and refresh tokens,
and renews access automatically. Hardcover uses its owner API token. Both use
12-hour stale-while-revalidate snapshots and preserve the last successful
public result on transient provider failure. Their public profile links are
derived from the authenticated provider identities.

Spotify uses a separate owner-only OAuth client in local and production Studio.
Its optional public surface preserves Spotify's returned Top Tracks order for
one official time window at a time, with no inferred play counts or listening
analytics. The ranked groove is only an ordinal navigator; playback remains in
one consent-gated official Spotify embed. Top Tracks publication is disabled by
default and Spotify credentials, tokens, and snapshots never enter the local
promotion handoff.

Strava is configured through Studio with a public athlete profile and an
optional complete Strava-generated profile-feed, weekly-summary, activity, or
route iframe. The server validates the exact official host and verifies that a
widget is anonymously frameable before publishing it. `/play` still requires
visitor consent before loading third-party content and falls back to the
athlete profile when a cumulative widget redirects to sign-in.

Steam uses an owner-supplied Web API key and SteamID64 only from the server,
publishes bounded summaries of public game details, and keeps no more than two
sanitized snapshots. Configure the actual D1 storage country or countries in
`STEAM_DATA_STORAGE_COUNTRIES` before connecting it. If public game visibility
is removed, the public snapshots and prior sync history are purged.
Disconnecting any Play provider deletes its credentials or configuration,
snapshots, pending OAuth transactions, sync history, and provider-specific
audit history, then unpublishes that stream. The public
[privacy page](./app/privacy/page.tsx) records retrieval, storage, retention,
and deletion behavior.

Follow the exact owner workflow in
[Play connections: owner setup](./docs/play-connections.md) and use
[.env.example](./.env.example) for local configuration. Never commit real
provider credentials or encryption keys.

## Deployment

The public production path is an owner-controlled Cloudflare Worker and D1
database. The existing OpenAI Sites deployment stays private and unchanged as
a rollback environment; `.openai/hosting.json` remains only to preserve that
packaging path. Checked-in migrations live under `drizzle/`.

Follow [the Cloudflare release runbook](./docs/cloudflare-release.md) to create
the Access application and D1 database, prepare an immutable Worker config,
set secrets, apply migrations, deploy, and run logged-out smoke tests. Do not
request workspace-admin access, expose a Sites bypass token, or make the GitHub
repository public.
