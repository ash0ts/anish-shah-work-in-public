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
npx --no-install wrangler secret put SIMULATION_GATEWAY_ACCOUNT_ID --config dist/server/wrangler.public.json
npx --no-install wrangler secret put SIMULATION_GATEWAY_ID --config dist/server/wrangler.public.json
npx --no-install wrangler secret put SIMULATION_GATEWAY_TOKEN --config dist/server/wrangler.public.json
npx --no-install wrangler secret put SIMULATION_GATEWAY_BYOK_ALIAS --config dist/server/wrangler.public.json
```

Never rotate `CONNECTOR_ENCRYPTION_KEY` during an ordinary release. Bootstrap
changes need their own recovery notes and are not covered by the recurring
[production release plan](./release.md).

Create a production-only Cloudflare AI Gateway and store the Anthropic key
there under the configured BYOK alias. The Worker must never receive the
Anthropic key directly. In the Gateway dashboard:

- disable prompt/response logging and payload collection;
- disable response caching;
- configure DLP to block likely secrets and sensitive values;
- configure content Guardrails for visitor and model text;
- set a hard spend limit consistent with the application daily-call ceiling;
  and
- confirm the Gateway token is scoped only to the production Gateway.

The Worker also requests no payload logging, no cache, one Gateway attempt, and
a bounded timeout on every model call. Those request flags do not replace the
Gateway-wide controls. Staging uses a different Gateway, token, BYOK alias,
provider key, budget, and session key.

### Two-release simulation bootstrap

The first production deployment that introduces simulation persistence must
keep `SIMULATION_EXPERIENCE_MODE=disabled` and apply the reviewed additive
`0006_public_model_simulation.sql` migration. After that disabled release is
healthy, enter provider approvals through owner-only Studio. Only then prepare
a second, no-migration activation release with `campaign-v1` and live AI. This
ordering prevents a release plan from claiming approvals before their protected
table exists.

A no-migration `coming-soon` release may follow the infrastructure release
before campaign approval. It exposes the semantic doorway and server-rendered
placeholder while keeping every Simulation API unavailable. It must use
`SIMULATION_AI_MODE=authored-only`, carry no approval variables, stay noindexed,
and remain absent from the sitemap.

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
- A staging-only Cloudflare AI Gateway, Gateway token, Anthropic BYOK alias,
  daily spend cap, DLP rules, and content Guardrails.

The staging Gateway must not share an ID, token, BYOK alias, budget, or provider
key with production. Disable prompt/response logging and response caching in the
Gateway dashboard. The Worker also sends per-request no-payload-log,
skip-cache, one-attempt, and bounded-timeout controls; the dashboard settings
remain the environment-wide safety net. Verify those controls before entering
any provider approval in staging Studio.

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

Set Simulation secrets against only the staging configuration before the
later `campaign-v1` activation. Enter values interactively; never echo, commit,
or place them in the release plan:

```bash
npx --no-install wrangler secret put SIMULATION_SESSION_HMAC_KEY --config dist/server/wrangler.staging.json
npx --no-install wrangler secret put SIMULATION_GATEWAY_ACCOUNT_ID --config dist/server/wrangler.staging.json
npx --no-install wrangler secret put SIMULATION_GATEWAY_ID --config dist/server/wrangler.staging.json
npx --no-install wrangler secret put SIMULATION_GATEWAY_TOKEN --config dist/server/wrangler.staging.json
npx --no-install wrangler secret put SIMULATION_GATEWAY_BYOK_ALIAS --config dist/server/wrangler.staging.json
```

Use the owner-only Simulation section in staging Studio to enable only
providers whose permission record covers both `game_display` and `llm_context`.
References and notes remain protected D1 fields; release evidence uses only
provider names and the one-way approval-state digest.

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

Then enter provider approvals and author/publish an owner-reviewed Travel
snapshot in staging Studio. Wait for the offset maintenance cron to record a
current Travel cleanup heartbeat. Choose the reviewed public state for the next
no-migration release: `coming-soon` publishes only the noindexed
server-rendered doorway, while `campaign-v1` activates the live campaign and
requires sanitized approval values. This two-release bootstrap avoids inventing
approval evidence or atlas state before their protected tables and media
boundary exist. Keep both disabled variables set for every guarded command in
the first release; changing either makes the prepared configuration fail
closed. Owner Travel Desk writes remain available while the public atlas route
is disabled.

An integrated Simulation-and-Travel staging database reports
`0006_public_model_simulation.sql` followed by `0007_travel_atlas.sql` as
pending when it still ends at `0005`. Include only the exact files reported by
the remote pending list, in that order; later releases use an empty migration
list. Never rename or replace a migration already applied to staging.
