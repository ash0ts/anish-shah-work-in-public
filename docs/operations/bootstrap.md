# Hosted infrastructure bootstrap

This is the sole authority for one-time or recovery provisioning of production
and staging Cloudflare resources, durable secrets, provider applications, and
the first feature-schema activation sequence. These actions are not ordinary
release steps. Every hosted mutation still requires explicit authorization.
Use [Staging releases](./staging.md) and [Production release](./release.md) only
after the target tier's durable resources exist.

## Production infrastructure

Provision infrastructure separately from a code release. Create the production
KV namespace once and keep the binding name exactly `PUBLICATION_CACHE`:

```bash
npx --no-install wrangler kv namespace create PUBLICATION_CACHE
```

Record its namespace ID in the private infrastructure inventory. Reuse that
namespace across releases; do not delete or recreate it for an ordinary
deployment.

Postcard Planet adds one private production media bucket. Create it once and
keep its name exactly `anish-shah-travel-media`:

```bash
export CLOUDFLARE_ACCOUNT_ID='690e6286eb53a6df1bd0080633caf91f'
npx --no-install wrangler whoami
npx --no-install wrangler r2 bucket list
npx --no-install wrangler r2 bucket create anish-shah-travel-media
```

Require `whoami` to show that exact account. The list command must succeed
before the create command. Cloudflare error
`10042` means R2 is not enabled for the owning account; enable it in the
Cloudflare dashboard and repeat the read-only check. Do not bypass the failure
or substitute a staging bucket.

The generated production configuration binds that bucket as `TRAVEL_MEDIA`,
Cloudflare Images as `IMAGES`, and the Travel media rate limiter as
`TRAVEL_MEDIA_RATE_LIMITER` with the reviewed production namespace
`88001006`. Treat the bucket and namespace as durable production coordinates.
They must never equal their staging counterparts, and PR preview receives none
of these bindings. Cloudflare Images must be enabled for the owning account
before accepting an upload; the Worker fails closed when either media binding
is unavailable.

Set durable secrets interactively only during initial provisioning or an
explicitly approved rotation:

```bash
npx --no-install wrangler secret put CONNECTOR_ENCRYPTION_KEY --config dist/server/wrangler.public.json
npx --no-install wrangler secret put RATE_LIMIT_SALT --config dist/server/wrangler.public.json
npx --no-install wrangler secret put SIMULATION_SESSION_HMAC_KEY --config dist/server/wrangler.public.json
```

Never rotate `CONNECTOR_ENCRYPTION_KEY` during an ordinary release. Bootstrap
changes need their own recovery notes and are not covered by the recurring
[production release plan](./release.md).

The current conversation preview does not use AI Gateway or Anthropic BYOK.
Production stays disabled. Do not provision model credentials for production.

### Two-release simulation bootstrap

Apply the existing reviewed migration chain before using local or separately
authorized staging owner preview. Never edit applied migration 0006 or delete
historical approval records. The new conversation uses those session tables and
encrypted editorial settings without a migration. Google setup and processing
permissions are entered only in that environment's Studio. Public activation
requires a separate policy/eligibility review, not a second automatic release.

### First Travel activation

Keep `TRAVEL_ATLAS_MODE=disabled` for the first code deployment that introduces
the Travel schema. Preparing private trips in production Studio does not
publish `/play/travel`. After that disabled release is healthy, author and
publish an owner-reviewed active Travel snapshot, complete explicit visual
acceptance, and use a later guarded release to select `atlas-v1`.

The integrated schema adds Simulation as
`0006_public_model_simulation.sql` and Travel as `0007_travel_atlas.sql`.
Include only migrations reported pending on the production database and never
rename or replace an applied migration.

## Staging infrastructure

Provision these resources through the Cloudflare dashboard or separately
reviewed infrastructure commands. Ordinary staging scripts do not create them:

First verify that R2 is enabled for the owning Cloudflare account:

```bash
export CLOUDFLARE_ACCOUNT_ID='690e6286eb53a6df1bd0080633caf91f'
npx --no-install wrangler whoami
npx --no-install wrangler r2 bucket list
```

Require `whoami` to show that exact account before continuing. If Wrangler
returns Cloudflare error `10042`, enable R2 in the Cloudflare
dashboard, then repeat the read-only list command. Do not bypass this check,
substitute a production bucket, or continue with an atlas-enabled staging
release. Cloudflare Images must also be enabled before Travel upload
acceptance.

- Worker `anish-shah-work-in-public-staging`.
- Custom Domain `staging.anish-shah-is.online`.
- D1 database `anish-shah-work-in-public-staging`.
- Dedicated `PUBLICATION_CACHE` KV namespace.
- Dedicated private `anish-shah-travel-media-staging` R2 bucket and `IMAGES`
  processing binding.
- Six staging-only Rate Limiting namespace identifiers, including dedicated
  `SIMULATION_RATE_LIMITER` and `TRAVEL_MEDIA_RATE_LIMITER` namespaces.
- Dedicated `CONNECTOR_ENCRYPTION_KEY`, `RATE_LIMIT_SALT`, and
  `SIMULATION_SESSION_HMAC_KEY` secrets.
- A staging Access application and audience.
- Optional owner-preview Gemini setup saved through staging Studio, with a
  separate key, paid-service review, Google permissions, and hard call budgets.

No production model key, approval record, or transcript is copied into staging.
The direct Worker adapter has no Gateway DLP claim; see the
[conversation safeguards](../architecture/meet-me-simulation.md).

The Access application protects `staging.anish-shah-is.online/*` with the exact
owner email. Add more-specific applications that bypass the Access login page
only for these callback paths:

```text
/api/connectors/myanimelist/oauth/callback
/api/connectors/spotify/oauth/callback
/api/connectors/discogs/oauth/callback
```

The Worker still verifies encrypted, expiring, owner-bound, single-use OAuth
state. The bypass exists only so a provider can return to the callback.

Register separate staging provider applications with these exact callbacks:

```text
https://staging.anish-shah-is.online/api/connectors/myanimelist/oauth/callback
https://staging.anish-shah-is.online/api/connectors/spotify/oauth/callback
https://staging.anish-shah-is.online/api/connectors/discogs/oauth/callback
```

Enter all staging credentials through staging Studio. Never copy a production
token, snapshot, database, KV value, or encryption key.

MyAnimeList, Spotify, and Discogs must use staging-specific application
registrations. Hardcover, Steam, and Strava may be entered manually when their
live staging behavior is under review. Complete authorization, refresh,
publication acknowledgement where applicable, and recovery testing in staging;
a successful callback alone is not connector acceptance.

Before the first guarded staging release, list the Worker secret names and
confirm that `CONNECTOR_ENCRYPTION_KEY` and `RATE_LIMIT_SALT` already exist.
They are required by connector storage and protected request throttling even
when Simulation and Travel are disabled. Add a missing value interactively;
never echo it, copy it from production, or rotate an existing encryption key
as part of an ordinary release:

```bash
npx --no-install wrangler secret list --config dist/server/wrangler.staging.json
npx --no-install wrangler secret put CONNECTOR_ENCRYPTION_KEY --config dist/server/wrangler.staging.json
npx --no-install wrangler secret put RATE_LIMIT_SALT --config dist/server/wrangler.staging.json
```

Set only the independent session HMAC key before an authorized owner preview:

```bash
npx --no-install wrangler secret put SIMULATION_SESSION_HMAC_KEY --config dist/server/wrangler.staging.json
```

Use staging Studio's Gemini setup after the disabled release is healthy.
Saving a key or enabling owner preview does not authorize public AI. Collection
processing needs separate Google permission; Strava and Travel remain excluded.

Staging Studio does not render production handoff controls, and staging routes
cannot issue, accept, stage, or apply a production promotion code. Local and
production retain their existing reviewed handoff; staging remains a separate
credential island.

### First staging feature activation

For the first deployment to a staging database that does not yet have migration
`0006_public_model_simulation.sql`, set
`STAGING_SIMULATION_EXPERIENCE_MODE=disabled` and
`STAGING_TRAVEL_ATLAS_MODE=disabled` before `staging:prepare`. Plan, migrate,
upload, stage, bootstrap, checkpoint, and promote that infrastructure-only
version without approval variables by following [Staging releases](./staging.md).

Then author/publish an owner-reviewed Travel snapshot in staging Studio and
wait for the cleanup heartbeat. Travel may later use `atlas-v1` after acceptance.
A separately approved `conversation-v2` staging review remains owner-only and
starts with authored archive search; Studio controls private model setup.
Keep both disabled variables set for every guarded command in
the first release; changing either makes the prepared configuration fail
closed. Owner Travel Desk writes remain available while the public atlas route
is disabled.

An integrated Simulation-and-Travel staging database reports
`0006_public_model_simulation.sql` followed by `0007_travel_atlas.sql` as
pending when it still ends at `0005`. Include only the exact files reported by
the remote pending list, in that order; later releases use an empty migration
list. Never rename or replace a migration already applied to staging.
