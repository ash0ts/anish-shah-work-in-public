# Staging and PR previews

This is the canonical contract for local, PR preview, live staging, and
production isolation. Production mutation and smoke testing belong only in the
[production release runbook](./release.md). The private OpenAI Sites deployment
is a reference/recovery environment outside this promotion path.

The site has four deliberately isolated execution contexts:

| Tier | Origin | State | Intended use |
| --- | --- | --- | --- |
| Local | `http://localhost:3000` | Local D1 and local-only secrets | Development |
| PR preview | `https://pr-<number>.anish-shah-is.online` | Checked-in public content and synthetic connector fixtures | Visual and interaction review |
| Staging | `https://staging.anish-shah-is.online` | Dedicated D1, KV, secrets, Access app, and provider registrations | OAuth, migration, connector, and Safari acceptance |
| Production | `https://anish-shah-is.online` | Production D1, KV, secrets, Access, and provider registrations | Public site |

Code can move between tiers. Credentials, OAuth transactions, snapshots,
database rows, KV envelopes, encryption keys, rate-limit salts, and publication
approval never do.

Hosted tiers must declare `DEPLOYMENT_TIER`, `SITE_URL`,
`PRODUCTION_SITE_URL`, `PUBLIC_CONTENT_MODE`, and `PLAY_EXPERIENCE_MODE`
explicitly. Staging and preview use `my-room-2001`. Unknown tiers, missing
coordinates, or cross-tier hosts fail closed. Staging and preview canonicals
point to the equivalent production path without making those tiers indexable.

## One-time staging infrastructure

Provision these resources through the Cloudflare dashboard or separately
reviewed infrastructure commands. Ordinary staging scripts do not create them:

- Worker `anish-shah-work-in-public-staging`.
- Custom Domain `staging.anish-shah-is.online`.
- D1 database `anish-shah-work-in-public-staging`.
- Dedicated `PUBLICATION_CACHE` KV namespace.
- Five staging-only Rate Limiting namespace identifiers, including a dedicated
  `SIMULATION_RATE_LIMITER` namespace.
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

Set simulation secrets against only the staging configuration. Enter values
interactively; never echo, commit, or place them in the release plan:

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

## Prepare a staging candidate

Use the corporate-CA shell when the VPN is enabled:

```bash
export PATH='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:/usr/bin:/bin:/usr/sbin:/sbin'
export NODE_USE_SYSTEM_CA=1
export XDG_CONFIG_HOME="$HOME/.config"
export WRANGLER_LOG_PATH="$PWD/.wrangler/wrangler.log"
```

Export only the exact staging coordinates. Production D1, KV, Access-audience,
and rate-limit fingerprints are pinned in the trusted release contract from the
currently deployed production resources; the operator cannot substitute a
different comparison target:

```bash
export STAGING_VALIDATED_SHA="$(git rev-parse HEAD)"
export STAGING_CLOUDFLARE_D1_DATABASE_ID='<staging D1 UUID>'
export STAGING_CLOUDFLARE_D1_DATABASE_NAME='anish-shah-work-in-public-staging'
export STAGING_CLOUDFLARE_PUBLICATION_CACHE_ID='<staging KV ID>'
export STAGING_CF_ACCESS_AUD='<staging Access audience>'
export STAGING_OWNER_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'
export STAGING_ARTWORK_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'
export STAGING_PROMOTION_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'
export STAGING_OAUTH_CALLBACK_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'
export STAGING_SIMULATION_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'

export OWNER_EMAILS='<exact owner email>'
export CF_ACCESS_TEAM_DOMAIN='https://<team>.cloudflareaccess.com'
unset LOCAL_OWNER_EMAIL

npm run staging:prepare
```

For the first deployment to a staging database that does not yet have migration
`0006_public_model_simulation.sql`, set
`STAGING_SIMULATION_EXPERIENCE_MODE=disabled` before `staging:prepare`. Plan,
migrate, deploy, and checkpoint that infrastructure-only version without
approval variables. Then enter provider approvals in staging Studio, unset
`STAGING_SIMULATION_EXPERIENCE_MODE`, rebuild the staging configuration, and
prepare a second no-migration activation plan using the sanitized health values
below. This two-release bootstrap avoids inventing approval evidence before its
protected table exists. Keep the disabled variable set for every guarded command
in the first release; changing it makes the prepared configuration fail closed.

The generator hashes each supplied staging coordinate and fails if any D1, KV,
Access audience, or Rate Limiting namespace matches the pinned production
contract. Updating that production contract requires a reviewed code change.
The generator writes only the ignored
`dist/server/wrangler.staging.json`.

`staging:prepare` runs the prebuild checks, builds exactly once, prepares the
staging configuration, writes the release-build checkpoint, and reuses that
same `dist` for candidate scans and Browser Quality. Subsequent staging commands
verify the checkpoint and fail if any deployable byte changes.

Record the current staging Worker version, staging D1 Time Travel bookmark,
reviewed migration list, and four exact-SHA successful workflow URLs. The
temporary owner-runner procedure in [Testing and release gates](../testing.md)
is acceptable because it preserves the same active workflow identities and
checks. Browser Quality must be a manually dispatched run for the same full SHA
even when the pull request was documentation-only. When the staging candidate
lives on an owner-controlled `release/*` branch, dispatch from that branch's
workflow definitions rather than forcing `main`; use the `WORKFLOW_REF`
procedure in the testing guide:

```bash
export STAGING_PREVIOUS_WORKER_VERSION='<current staging Worker version>'
export STAGING_D1_BOOKMARK='<staging D1 bookmark>'
export STAGING_MIGRATION_LIST=''
export STAGING_VALIDATION_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export STAGING_GITLEAKS_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export STAGING_CODEQL_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export STAGING_BROWSER_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'

# Copy only these sanitized values from owner-only GET /api/studio/health.
export STAGING_SIMULATION_APPROVED_PROVIDERS='<comma-separated simulation.approvedProviders>'
export STAGING_SIMULATION_APPROVAL_DIGEST='<simulation.providerApprovalDigest>'

npm run staging:plan
npm run staging:migrate
npm run staging:upload
export STAGING_WORKER_VERSION='<uploaded staging version>'
npm run staging:deploy
```

Leave the two simulation approval variables unset for the disabled
infrastructure release. They are mandatory only for the subsequent
`campaign-v1` activation.

The infrastructure staging deployment normally reports
`0006_public_model_simulation.sql` as pending. Include it exactly in
`STAGING_MIGRATION_LIST` only when the remote pending list does; later releases
use an empty migration list. `staging:plan` rejects an enabled campaign without
at least one approved provider name and a 64-character sanitized digest. It
records the campaign version, experience mode, AI mode, provider, model,
provider names, and digest—never approval references or credentials.

For an authenticated owner checkpoint, pass a short-lived staging Access JWT
without printing or storing it:

```bash
export STAGING_ACCESS_JWT='<short-lived staging Access JWT>'
npm run staging:bootstrap
npm run staging:checkpoint
npm run staging:smoke
unset STAGING_ACCESS_JWT
```

`staging:bootstrap` is required for a fresh staging D1/KV. It calls the
owner-protected staging publication endpoint, which seeds only the checked-in
sanitized records, writes the staging D1 snapshot, and activates the staging KV
pointer. It is idempotent for an already-current content version. The following
checkpoint refuses a missing or mismatched KV pointer. The exact staging origin
and configuration guard keep this command separate from production.
The checkpoint also requires the live Gateway to be configured and compares
the runtime campaign/model settings plus current approval names and digest with
the ignored staging plan. A changed or expired approval therefore stops the
candidate instead of silently changing model context.

The staging plan records the explicit Play mode, `CONTENT_VERSION`,
`COPY_VERSION`, configuration and deployable-artifact hashes, four validation
workflow identities, migration hashes, prior Worker version, and D1 bookmark.
Checkpointing verifies the candidate SHA, both content versions, active D1
publication, and matching KV pointer. Readiness retries only bounded, read-only
checks; uncertain writes are never retried automatically.

### Live staging acceptance

Before production release, verify the exact staged SHA in Safari and an
automated browser:

- `/play` performs no connector read before selection;
- all six direct object routes load only their associated provider;
- real staging OAuth, refresh, publish/unpublish, stale, and recovery paths work;
- Spotify and Strava frames remain consent-gated;
- Discogs obeys its four-hour refresh eligibility and six-hour public cutoff;
- My Room capability fallbacks and semantic navigation work without WebGL;
- Studio health, publication checkpoint, noindex headers, and private/no-store
  caching are correct; and
- owner Access succeeds while logged-out and non-owner access fails.

Staging uses an offset hourly cron at minute `47` for retention and due Discogs
refresh. Its heartbeat and sync history belong only to staging.

Rollback changes only the staging Worker version:

```bash
npm run staging:rollback
```

Restore staging D1 separately and only when database state caused the failure.
None of these commands invoke production release scripts.
For a simulation-only failure, roll back the Worker or prepare a reviewed
staging version with `SIMULATION_EXPERIENCE_MODE=disabled`; do not restore D1,
copy production approvals, or rotate connector credentials.

## PR preview lifecycle

Same-repository pull requests receive an Access-protected synthetic preview at
`pr-<number>.anish-shah-is.online` after Validate succeeds. The untrusted PR
job receives no Cloudflare credential. It uploads only the validated build and
non-secret metadata. A `workflow_run` job from trusted `main` then:

1. Downloads that exact build.
2. Runs the trusted bundle scanner and preview config generator.
3. Deploys a Worker named `anish-shah-work-in-public-pr-<number>`.
4. Smoke-tests through a preview-only Access service token.
5. Updates a persistent PR comment.

Copy-only PRs use a stricter variant: an unprivileged job packages only
validated `content/copy/**/*.md` text, then a trusted job checks out base-branch
code, reapplies and revalidates that text, computes `COPY_VERSION`, builds the
synthetic preview, and captures affected-route screenshots. If any code,
workflow, configuration, binary, symlink, or unapproved path changes, the
trusted copy lane stops and the PR returns to the normal engineering workflow.
See [Copywriting](../copywriting.md).

Configure the GitHub `preview` environment with:

- Secret `CLOUDFLARE_PREVIEW_API_TOKEN`. Cloudflare's Workers Scripts Write
  permission is account-scoped, so a token that attaches preview Custom
  Domains cannot be resource-scoped to only `*-pr-*` Workers. Grant it no D1,
  KV, secret, or unrelated account permissions and protect the GitHub
  environment accordingly.
- Secrets `PREVIEW_ACCESS_CLIENT_ID` and `PREVIEW_ACCESS_CLIENT_SECRET`.
- Variables `CF_ACCESS_TEAM_DOMAIN` and `PREVIEW_CF_ACCESS_AUD`.

Create a wildcard Access application for
`pr-*.anish-shah-is.online/*`. Allow explicitly approved reviewers and the
preview CI service token. Preview Workers contain no D1, KV, encryption,
provider, cron, Studio, write, promotion, or OAuth capability. The Worker
accepts a verified Access service principal only in preview; it never grants
owner authorization.

The preview simulation is a deterministic authored fixture. It never calls AI
Gateway or Anthropic, creates a simulation session row, reads provider APIs, or
uses protected approval state. Preview success is gameplay and visual evidence
only.

The trusted-main workflow compensates for that Cloudflare IAM limitation. It
runs only after same-repository validation, rechecks that the PR is open and at
the exact validated head, never executes PR code with the token, and generates
only a numeric `pr-<number>` Worker/domain from an allowlisted configuration.
It snapshots the production Worker deployment plus apex Custom Domain before
deployment using the pinned account coordinate. An always-running post-deploy
guard fails if either production coordinate changes. The smoke check does not
follow redirects while holding the preview Access service token. These controls
reduce blast radius; they do not turn the account-scoped token into a
resource-scoped credential.

Closing a PR cancels any in-flight deployment for that PR and deletes its exact
ephemeral Worker. A delayed validation run must recheck the open PR and current
head before it can deploy. A daily janitor lists only
Worker names matching `anish-shah-work-in-public-pr-<number>` and removes those
whose PR is closed. Cleanup queries the exact hostname-and-service pair,
requires an unambiguous record for the same PR number, detaches that domain ID, and
then deletes the exact Worker. It cannot match the apex, staging, or another
PR's domain or Worker.

All staging and preview responses are noindexed and private/no-store, except
content-hashed first-party assets. Preview connector scenarios are synthetic;
use `?fixture=unavailable`, `empty`, `stale`, `long-title`,
`missing-artwork`, or `maximum-density` on connector reads during QA.
The same scenarios are selectable at page level with
`/play?fixture=<scenario>`; Play passes the scenario only in the exact preview
tier and then forwards it to whichever stream the reviewer activates. Ready
fixtures include neutral first-party placeholder artwork, while
`missing-artwork` deliberately omits the artwork contract.

Every staging and preview response includes
`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`.
Their `robots.txt` disallows all crawling, no staging/preview sitemap is
advertised, browser titles identify the tier, and dynamic responses are
`private, no-store`. Access protection is required but is not treated as the
only indexing control.

## Visual review evidence

The Browser quality workflow produces a 14-day `room-browser-review-<SHA>`
artifact for each tested commit. It contains an interaction recording and
synthetic screenshots for:

- The static poster and neutral interactive room.
- All four authored rotation bounds.
- Each of the six focused room objects.
- Every object screen in ready, empty, stale, unavailable, long-title, and
  missing-artwork states.
- One ready mobile composition per object screen.

Generate the same ignored evidence locally after a build:

```bash
npm run capture:room-review
```

Review `.playwright/room-review/manifest.json` and the accompanying images.
These captures never read D1, provider APIs, or owner data; the preview runtime
serves only deterministic synthetic fixtures and first-party placeholders.
