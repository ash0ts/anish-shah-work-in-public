# Staging releases

This is the canonical contract for environment isolation, repeatable live
staging candidates, and staging acceptance. Production mutation and smoke
testing belong only in the [production release runbook](./release.md). PR
preview lifecycle and synthetic visual review belong in
[PR previews](./previews.md).
One-time resource provisioning and first-schema activation belong in
[Hosted infrastructure bootstrap](./bootstrap.md). The private OpenAI Sites
deployment is a reference/recovery environment outside this promotion path.

The site has four deliberately isolated execution contexts:

| Tier | Origin | State | Intended use |
| --- | --- | --- | --- |
| Local | `http://localhost:3000` | Local D1 and local-only secrets | Development |
| PR preview | `https://pr-<number>.anish-shah-is.online` | Checked-in public content and synthetic connector/Travel fixtures; no R2 | Visual and interaction review |
| Staging | `https://staging.anish-shah-is.online` | Dedicated D1, KV, R2, secrets, Access app, and provider registrations | OAuth, media, migration, connector, and Safari acceptance |
| Production | `https://anish-shah-is.online` | Production D1, KV, R2, secrets, Access, and provider registrations | Public site |

Code can move between tiers. Credentials, OAuth transactions, snapshots,
database rows, KV envelopes, R2 objects, encryption keys, rate-limit salts, and
publication approval never do.

Hosted tiers must declare `DEPLOYMENT_TIER`, `SITE_URL`,
`PRODUCTION_SITE_URL`, `PUBLIC_CONTENT_MODE`, and `RELEASE_VERSION`
explicitly. My Room is the sole Play runtime. Unknown tiers, missing
coordinates, or cross-tier hosts fail closed. Staging and preview canonicals
point to the equivalent production path without making those tiers indexable.

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
export RELEASE_VERSION="$(node -p "require('./package.json').version")"
export STAGING_CLOUDFLARE_D1_DATABASE_ID='<staging D1 UUID>'
export STAGING_CLOUDFLARE_D1_DATABASE_NAME='anish-shah-work-in-public-staging'
export STAGING_CLOUDFLARE_PUBLICATION_CACHE_ID='<staging KV ID>'
export STAGING_CLOUDFLARE_TRAVEL_MEDIA_BUCKET='anish-shah-travel-media-staging'
export STAGING_CF_ACCESS_AUD='<staging Access audience>'
export STAGING_OWNER_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'
export STAGING_ARTWORK_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'
export STAGING_PROMOTION_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'
export STAGING_OAUTH_CALLBACK_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'
export STAGING_SIMULATION_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'
export STAGING_TRAVEL_MEDIA_RATE_LIMIT_NAMESPACE_ID='<staging namespace>'

export OWNER_EMAILS='<exact owner email>'
export CF_ACCESS_TEAM_DOMAIN='https://<team>.cloudflareaccess.com'
unset LOCAL_OWNER_EMAIL

# Simulation remains fully unavailable for the v2.2.0 candidate.
export STAGING_SIMULATION_EXPERIENCE_MODE='disabled'

npm run staging:prepare
```

`RELEASE_VERSION` is exact SemVer and must equal `package.json`. The generated
staging config, ignored staging plan, owner health response, and checkpoint all
bind to that same value. PR previews derive it from `package.json` and record it
in their trusted metadata rather than accepting an arbitrary workflow value.

If this staging database has not completed its initial Simulation and Travel
schema sequence, stop here and follow
[Hosted infrastructure bootstrap](./bootstrap.md). This runbook assumes the
durable tier exists and documents the repeatable candidate train.

The generator hashes each supplied staging coordinate and fails if any D1, KV,
Access audience, or Rate Limiting namespace matches the pinned production
contract. Updating that production contract requires a reviewed code change.
R2 bucket names and Rate Limiting namespace IDs are also compared directly;
staging and production Travel media resources may never match.
The generator writes only the ignored
`dist/server/wrangler.staging.json`.

Download the exact `validated-dist-<SHA>` artifact produced by the successful
Validate run before `staging:prepare`. The command verifies that attestation,
adds only the reviewed staging configuration, writes the release-build
checkpoint, and reuses those bytes for candidate scans. It does not rebuild or
repeat Browser Quality; the separately recorded exact-SHA Browser Quality run
already exercised the Validate artifact. Subsequent staging commands verify the
checkpoint and fail if any deployable byte changes.

Record the current staging Worker version, staging D1 Time Travel bookmark,
reviewed migration list, and four exact-SHA successful workflow URLs. The
[disposable owner-runner procedure](../../.github/runner/README.md) is acceptable
because it preserves the same active workflow identities and checks. Browser
Quality must be a manually dispatched run for the same full SHA even when the
pull request was documentation-only. When the staging candidate lives on an
owner-controlled `release/*` branch, dispatch from that branch's workflow
definitions rather than forcing `main`; use the runner guide's `WORKFLOW_REF`
procedure:

```bash
export STAGING_PREVIOUS_WORKER_VERSION='<current staging Worker version>'
export STAGING_D1_BOOKMARK='<staging D1 bookmark>'
export STAGING_MIGRATION_LIST=''
export STAGING_VALIDATION_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export STAGING_GITLEAKS_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export STAGING_CODEQL_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export STAGING_BROWSER_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'

# For campaign-v1 only, copy these sanitized values from owner-only health.
# Leave both unset for disabled or coming-soon.
export STAGING_SIMULATION_APPROVED_PROVIDERS='<comma-separated simulation.approvedProviders>'
export STAGING_SIMULATION_APPROVAL_DIGEST='<simulation.providerApprovalDigest>'

npm run staging:plan
npm run staging:migrate
npm run staging:upload
export STAGING_WORKER_VERSION='<uploaded staging version>'
npm run staging:stage
```

Leave the two simulation approval variables unset for `disabled` and
`coming-soon`. They are mandatory only for `campaign-v1`. An `atlas-v1`
checkpoint requires an active Travel publication and current cleanup heartbeat.
`staging:plan` rejects an enabled campaign without
at least one approved provider name and a 64-character sanitized digest. It
records the campaign version, experience mode, AI mode, provider, model,
provider names, and digest—never approval references or credentials.

For an authenticated owner checkpoint, pass a short-lived staging Access JWT
without printing or storing it:

```bash
export STAGING_ACCESS_JWT='<short-lived staging Access JWT>'
npm run staging:bootstrap
npm run staging:checkpoint
npm run staging:deploy
npm run staging:smoke
unset STAGING_ACCESS_JWT
```

`staging:stage` reconciles the reviewed triggers, keeps the prior version at
100% traffic, and records the uploaded candidate at 0%. Bootstrap and
checkpoint requests use Cloudflare's exact Worker-version override header so
they exercise that candidate without exposing it to ordinary staging traffic.
After the single deployment write, the command performs a bounded read-only
poll of `wrangler deployments status --json` and requires the exact
candidate-at-0/prior-at-100 split. It never retries an uncertain deployment
write.
Every post-upload action rechecks that the remote migration list is empty. The
stage command records an ignored receipt binding the trigger settings to the
exact configuration and plan; bootstrap, checkpoint, and promotion reject a
missing or stale receipt.
The checkpoint requires healthy owner status, an active D1/KV publication,
matching Simulation settings, and—when `atlas-v1` is enabled—a configured
Travel media boundary, active Travel publication, and current cleanup
heartbeat. It then writes an owner-protected release marker to D1.
`staging:deploy` refuses to promote unless that marker is newer than the plan
and a local ignored checkpoint receipt still matches the exact candidate,
`COPY_VERSION`, Simulation approvals, Travel publication, release/content
versions, active D1/KV publication, and the staged Cloudflare deployment ID and
traffic split. It rereads those candidate values and the exact 0/100 split
immediately before promotion. After the single promotion write it performs a
bounded read-only poll and requires the candidate to be the sole version at
100%. Only after that guarded promotion does
`staging:smoke` exercise ordinary 100%-traffic staging.

`staging:bootstrap` is required for a fresh staging D1/KV. It calls the
owner-protected, staging-only maintenance endpoint on the exact 0%-traffic
candidate first. That bounded retention pass initializes the general
maintenance heartbeat without waiting for a cron that cannot reach a 0%
version. Bootstrap then calls the protected publication endpoint, which seeds
only the checked-in sanitized records, writes the staging D1 snapshot, and
activates the staging KV pointer. Both operations are idempotent for an
already-current release. The following checkpoint refuses a stale general
retention heartbeat or a missing/mismatched KV pointer. The exact staging
origin and configuration guard keep these commands separate from production.
For a `campaign-v1` checkpoint, the live Gateway must be configured and the
runtime campaign/model settings plus current approval names and digest must
match the ignored staging plan. A changed or expired approval therefore stops
the candidate instead of silently changing model context. The initial disabled
infrastructure release does not require Gateway credentials or approvals. A
`coming-soon` checkpoint requires `/simulation` to return 200 with the global
staging noindex headers while all `/api/simulation/**` routes return 404; it
also requires health to report the campaign unconfigured and public visits not
to change model-call or session state. Existing protected approval rows may
remain stored, but they are not release evidence or runtime input in this mode.
Unless a reviewed staging override is added later, the application daily model
ceiling remains the runtime default of 500 calls.

The staging plan records `RELEASE_VERSION`, `CONTENT_VERSION`, `COPY_VERSION`,
configuration and deployable-artifact hashes, four validation
workflow identities, migration hashes, prior Worker version, and D1 bookmark.
Checkpointing verifies the candidate SHA, both content versions, active D1
publication, and matching KV pointer. Readiness retries only bounded, read-only
checks; uncertain writes are never retried automatically.

### Live staging acceptance

Before production release, verify the exact staged SHA in Safari and an
automated browser:

- `/play` performs no connector read before selection;
- all seven direct object routes load only their associated provider or Travel publication;
- real staging OAuth, manual Refresh, publish/unpublish, stale, and recovery
  paths work, while public reads and cron make no provider data calls;
- Spotify and Strava frames remain consent-gated;
- Discogs obeys its four-hour manual-refresh eligibility; approved stale
  display retains the real update time, and its isolated staging approval must
  never be copied to production;
- My Room capability fallbacks and semantic navigation work without WebGL;
- Pocket Room entry, swipe/tap separation, Back/Escape, and focus restoration work;
- Simulation completes in Action and Tactical modes with live-model and authored-fallback paths, bounded sessions, budgets, and rejected unsafe output;
- Postcard Planet supports semantic and 3D country/region/pin selection, metadata-free upload, atomic publish/unpublish, media authorization, and cleanup;
- Studio health, publication checkpoint, noindex headers, and private/no-store
  caching are correct; and
- owner Access succeeds while authenticated; logged-out and non-owner access
  fail closed.

Staging uses an offset hourly cron at minute `47` for retention and cleanup
only. Connector synchronization remains owner-triggered through staging Studio;
the heartbeat and sync history belong only to staging.

Rollback changes only the staging Worker version:

```bash
npm run staging:rollback
```

Restore staging D1 separately and only when database state caused the failure.
None of these commands invoke production release scripts.
For a simulation-only failure, roll back the Worker or prepare a reviewed
staging version with `SIMULATION_EXPERIENCE_MODE=disabled`; do not restore D1,
copy production approvals, or rotate connector credentials.

After the exact candidate passes the complete staging acceptance matrix, tag
that SHA once and leave the release pull request draft:

```bash
export STAGING_RC_TAG="v$(node -p "require('./package.json').version")"
node -e "if (!/-rc\.[0-9]+$/.test(require('./package.json').version)) process.exit(1)"
git tag "$STAGING_RC_TAG" "$STAGING_VALIDATED_SHA"
git push origin "$STAGING_RC_TAG"
```

Tags are immutable. If the tag already exists, verify it points to the same SHA
instead of moving it. A failed candidate becomes the next RC number. Do not
merge the release branch to `main`, create a final production tag, or change
production traffic from this runbook.
