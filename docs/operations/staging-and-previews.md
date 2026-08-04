# Staging and PR previews

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

## One-time staging infrastructure

Provision these resources through the Cloudflare dashboard or separately
reviewed infrastructure commands. Ordinary staging scripts do not create them:

- Worker `anish-shah-work-in-public-staging`.
- Custom Domain `staging.anish-shah-is.online`.
- D1 database `anish-shah-work-in-public-staging`.
- Dedicated `PUBLICATION_CACHE` KV namespace.
- Four staging-only Rate Limiting namespace identifiers.
- Dedicated `CONNECTOR_ENCRYPTION_KEY` and `RATE_LIMIT_SALT` secrets.
- A staging Access application and audience.

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

export OWNER_EMAILS='<exact owner email>'
export CF_ACCESS_TEAM_DOMAIN='https://<team>.cloudflareaccess.com'
unset LOCAL_OWNER_EMAIL

npm run staging:prepare
```

The generator hashes each supplied staging coordinate and fails if any D1, KV,
Access audience, or Rate Limiting namespace matches the pinned production
contract. Updating that production contract requires a reviewed code change.
The generator writes only the ignored
`dist/server/wrangler.staging.json`.

Record the current staging Worker version, staging D1 Time Travel bookmark,
reviewed migration list, and four exact-SHA successful workflow URLs. The
temporary owner-runner procedure in [Testing and release gates](../testing.md)
is acceptable because it preserves the same active workflow identities and
checks:

```bash
export STAGING_PREVIOUS_WORKER_VERSION='<current staging Worker version>'
export STAGING_D1_BOOKMARK='<staging D1 bookmark>'
export STAGING_MIGRATION_LIST=''
export STAGING_VALIDATION_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export STAGING_GITLEAKS_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export STAGING_CODEQL_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export STAGING_BROWSER_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'

npm run staging:plan
npm run staging:migrate
npm run staging:upload
export STAGING_WORKER_VERSION='<uploaded staging version>'
npm run staging:deploy
```

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

Rollback changes only the staging Worker version:

```bash
npm run staging:rollback
```

Restore staging D1 separately and only when database state caused the failure.
None of these commands invoke production release scripts.

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
