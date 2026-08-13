# Production release

This is the sole authority for production planning, mutation, checkpointing,
smoke testing, and attestation. It releases the owner-controlled Cloudflare
Worker. The private Sites
deployment remains a recovery/reference environment; it is not a public
rollback target.

Every release has two records:

1. An ignored pre-release plan at `dist/release-plan.json`, written before any
   release mutation.
2. An immutable checked-in attestation under `releases/`, written only after
   production smoke tests pass.

Do not deploy, apply a remote migration, rotate a secret, or change a
publication pointer before the pre-release plan exists.

The only public production origin is `https://anish-shah-is.online`. The
prepared Worker configuration pins the owning Cloudflare account, declares the
apex as its sole Custom Domain, disables `workers.dev`, and rejects any other
direct-production hostname. `www` is handled by a separate Cloudflare redirect
rule and is not a Worker route.

## Corporate-CA shell

When a corporate VPN is active, make Node trust the macOS system certificate
store before running any Wrangler command. Keep this setup in the same shell
for the entire release:

```bash
export PATH='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:/usr/bin:/bin:/usr/sbin:/sbin'
export NODE_USE_SYSTEM_CA=1
export XDG_CONFIG_HOME="$HOME/.config"
export WRANGLER_LOG_PATH="$PWD/.wrangler/wrangler.log"

npx --no-install wrangler whoami
```

If authentication expired, run `npx --no-install wrangler login`, then repeat
`whoami`. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`, disable TLS validation,
or copy a corporate CA certificate into this repository.

One-time Cloudflare resources, durable secrets, Gateway controls, and the
initial Simulation/Travel schema activation sequence belong in
[Hosted infrastructure bootstrap](./bootstrap.md). Confirm that work is complete
before starting a recurring production release; do not provision or rotate
infrastructure from this runbook.

Before deploying a release that changes an OAuth transaction schema, finish or
cancel every pending MyAnimeList, Spotify, and Discogs authorization in Studio.
Do not carry an in-flight provider callback across the deployment: transactions
missing the release's required encrypted fields fail closed as `invalid_state`
and must be started again.

## 1. Validate the exact commit and bytes

Merge through a reviewed PR, then manually dispatch Validate, Gitleaks, CodeQL,
and Browser Quality with the same full commit SHA. All four workflow identities
and successful conclusions must be valid. The
[disposable owner-runner procedure](../../.github/runner/README.md) keeps those
active workflow identities and gates intact when hosted Actions capacity is
unavailable. On the release machine:

For a release candidate, validate the pushed `release/<semver>` branch and keep
the `release/* → main` pull request draft. A production release validates the
exact merged `main` SHA. RC tags are immutable: a fix produces the next RC
number; never move an existing tag.

```bash
export RELEASE_LINE="$(node -p "require('./package.json').version.split('-')[0]")"
git switch "release/$RELEASE_LINE" # use main only for an authorized final release
git pull --ff-only
git status --short
export RELEASE_VALIDATED_SHA="$(git rev-parse HEAD)"
npm install --global npm@11.6.2 --ignore-scripts
npm ci
npm run db:local:migrate:clean
```

The worktree must be clean, `HEAD` must equal its upstream, and
`RELEASE_VALIDATED_SHA` must be the exact SHA validated by CI.

Use a shell that does not contain `LOCAL_OWNER_EMAIL`:

```bash
export CLOUDFLARE_D1_DATABASE_ID='<production D1 UUID>'
export CLOUDFLARE_D1_DATABASE_NAME='anish-shah-work-in-public'
export CLOUDFLARE_PUBLICATION_CACHE_ID='<production KV namespace ID>'
export PUBLIC_SITE_URL='https://anish-shah-is.online'
export RELEASE_VERSION="$(node -p "require('./package.json').version")"
export OWNER_EMAILS='<exact owner email>'
export CF_ACCESS_TEAM_DOMAIN='https://<team>.cloudflareaccess.com'
export CF_ACCESS_AUD='<Access application audience>'
export SIMULATION_EXPERIENCE_MODE='disabled'
export SIMULATION_AI_MODE='authored-only'
export TRAVEL_ATLAS_MODE='disabled'
npm run validate:release
```

`RELEASE_VERSION` must be exact SemVer and must exactly equal the checked-in
`package.json` version. Release candidates therefore use their matching exact
prerelease version; a missing, `v`-prefixed, or mismatched value fails
configuration generation before any hosted command can run. Keep the draft
release branch on its RC version. Bump both package files to the final exact
SemVer only in the separately authorized final-production change after the
release PR is approved.

Download the exact `validated-dist-<SHA>` artifact produced by the successful
Validate run before `validate:release`. The command verifies that attestation,
adds only the reviewed non-secret Worker configuration, writes an immutable
release-build checkpoint, runs candidate scans and rendered tests, and checks
the four exact-SHA evidence URLs during release preflight. It does not rebuild
or repeat Browser Quality and Lighthouse; their successful workflow already
exercised the same Validate artifact. The final checkpoint fails if any
deployable file changes.

My Room, 2001 and its seven semantic object routes are the only Play runtime.
There is no hosted Classic flag or fallback. The release plan records
`RELEASE_VERSION` and also computes `COPY_VERSION` from the copy deck and parser
contract. `COPY_VERSION` is distinct from canonical-data `CONTENT_VERSION`.

For an enabled campaign release, use
`SIMULATION_EXPERIENCE_MODE=campaign-v1` and `SIMULATION_AI_MODE=live` before
building. Hosted production rejects fixture mode and rejects an enabled
campaign that is not live. These non-secret values are embedded in the exact
Worker configuration and cannot be changed after validation without rebuilding
and replanning the release.

For a public placeholder release instead, use:

```bash
export SIMULATION_EXPERIENCE_MODE='coming-soon'
export SIMULATION_AI_MODE='authored-only'
```

Do not set provider-approval variables for that mode. A guarded release may
select `TRAVEL_ATLAS_MODE=atlas-v1` only with an owner-reviewed active Travel
snapshot and explicit visual acceptance. Follow
[Hosted infrastructure bootstrap](./bootstrap.md) when the target tier has not
completed its initial Simulation/Travel schema activation; this recurring
runbook lists only migrations still pending on the target database.

## 2. Capture read-only production coordinates

Before changing production, collect the current Worker version, a D1 Time
Travel bookmark, the remote migration state, and the four exact-SHA successful
GitHub Validate, Gitleaks, CodeQL, and Browser Quality run URLs:

```bash
npx --no-install wrangler versions list --config dist/server/wrangler.public.json
npx --no-install wrangler d1 time-travel info DB --config dist/server/wrangler.public.json
npx --no-install wrangler d1 migrations list DB --remote --config dist/server/wrangler.public.json
```

Copy the previous Worker version identifier and the literal pre-migration D1
bookmark from that output. Compare the remote migration list with the reviewed
SQL files in `drizzle/`. Only forward-compatible additive migrations may share
a release with code.

While signed in through Access as the owner, open:

```text
https://anish-shah-is.online/api/studio/publication-checkpoint
```

This protected, no-store endpoint reports the active publication's actual
snapshot hash, base content version, and whether the KV current pointer exactly
matches D1. It does not return records, identities, or provider data. Do not use
the checked-in bundle SHA as the publication hash; those hashes cover different
contracts. If the currently deployed version does not expose this endpoint, use
`none`, `none`, and `0` for the three publication inputs below and explicitly
plan the application-mediated bootstrap.

For an enabled simulation candidate, also read owner-only
`GET /api/studio/health` from production before planning. Copy only:

```text
simulation.approvedProviders
simulation.providerApprovalDigest
```

The provider list contains only currently enabled, unexpired approvals with
both `game_display` and `llm_context`. The digest is a one-way hash of the safe
approval projection. Do not copy approval references, timestamps, contacts,
notes, Studio responses, or provider data into a shell, plan, or issue. If the
list is empty or the digest is unavailable, leave production disabled and fix
the protected approval state first.

## 3. Write the pre-release plan

Set the release coordinates without applying a migration or deploying:

```bash
export RELEASE_PREVIOUS_WORKER_VERSION='<currently deployed version id>'
export RELEASE_D1_BOOKMARK='<literal pre-migration Time Travel bookmark>'
export RELEASE_VALIDATION_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export RELEASE_GITLEAKS_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export RELEASE_CODEQL_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export RELEASE_BROWSER_URL='https://github.com/ash0ts/anish-shah-work-in-public/actions/runs/<id>'
export RELEASE_MIGRATION_LIST=''
export RELEASE_PUBLICATION_HASH='<publication checkpoint contentHash, or none>'
export RELEASE_PUBLICATION_CONTENT_VERSION='<checkpoint contentVersion, or none>'
export RELEASE_PUBLICATION_KV_MATCH='<1 only when checkpoint says true; otherwise 0>'
npm run release:plan
```

For a `campaign-v1` release only, set these before `release:plan`:

```bash
export RELEASE_SIMULATION_APPROVED_PROVIDERS='<comma-separated simulation.approvedProviders>'
export RELEASE_SIMULATION_APPROVAL_DIGEST='<simulation.providerApprovalDigest>'
```

Leave both unset while Simulation is `disabled` or `coming-soon`.

`RELEASE_PREVIOUS_WORKER_VERSION` is mandatory. Every release needs an existing
version to hold 100% of traffic while the candidate is verified at 0%. If no
prior version is available, abort this release and establish a separate
protected bootstrap environment first. `RELEASE_MIGRATION_LIST` is a
comma-separated list of the reviewed, checked-in SQL migrations planned for
this release. Leave it empty when the remote migration inventory shows no
reviewed pending migration. Replace the empty value only with exact
remote-pending filenames; do not include an already-applied, absent-from-Git,
or unreviewed file.

A `campaign-v1` release plan requires at least one allowlisted provider name
and a 64-character approval digest. Disabled and coming-soon plans reject stale
approval variables. The plan records only campaign version, experience/AI
mode, provider/model, sorted provider names, and the digest; it has no field for
approval references or secrets. Initial feature-schema migration ordering is
owned by [Hosted infrastructure bootstrap](./bootstrap.md).

`release:plan` refuses a dirty worktree or a SHA mismatch. It also asks the
authenticated GitHub CLI to verify that all four distinct Actions runs belong
to this repository, use the expected active workflow names and paths, target
exact `HEAD`, and concluded successfully. Browser Quality must be a
`workflow_dispatch` run. URLs alone are not trusted. The plan records:

- the validated commit SHA and all four GitHub Actions identities and URLs;
- explicit `RELEASE_VERSION`, `CONTENT_VERSION`, and `COPY_VERSION`;
- the public content version and exact sanitized bundle SHA-256;
- the deployable artifact-set hash, file count, byte count, and manifest hash;
- the prior Worker version;
- the pre-migration D1 Time Travel bookmark and migration list; and
- the exact simulation campaign/model settings plus sanitized approval names
  and one-way approval-state digest; and
- checksums for the content attestation and prepared Worker configuration.

It also verifies that `HEAD` is pushed to the branch's configured upstream and
records a SHA-256 for every named migration. For a release with no migrations,
set `RELEASE_MIGRATION_LIST=''`; the recorded list will be empty.

If the checkpoint is absent, drifted, or based on a different content version,
explicitly select the audited, application-mediated bootstrap before creating
the plan:

```bash
export RELEASE_PREDEPLOY_BOOTSTRAP=1
npm run release:plan
```

The plan records `predeploy_bootstrap_required`. This authorizes only the new
Worker's audited public-content projector while that version is staged at 0%.
It does not authorize manual SQL, direct KV writes, a checked-in-bundle import,
or public traffic to the candidate.

Keep `dist/release-plan.json` intact through deployment and smoke testing. It is
ignored because it is a release-machine checkpoint, not repository state. Do
not hand-edit it.

## 4. Understand the staged publication checkpoint

The Worker accepts only publication snapshots produced by the application's
audited Studio projector: stage a versioned sanitized snapshot in KV, commit
the publication and active version in D1, then advance the KV current pointer
after D1 succeeds. This app-mediated flow is the only permitted seed or update
path. Never construct D1 rows or KV envelopes manually and never seed
production directly from the checked-in static bundle.

- Every plan, including one with a `compatible` publication, stages the new
  version at 0% beside the prior version at 100%. Compatibility means only that
  the staged browser checkpoint will not need to call Publish.
- If the plan says `predeploy_bootstrap_required`, the staged browser checkpoint
  invokes the new Worker's audited Studio publish route before validating D1
  and KV. Public traffic remains on the prior version.
- In both cases, the staged Worker must write an owner-only D1 release marker
  that binds the candidate SHA and content version to the current verified
  publication. Promotion is blocked until that marker exists and validates.

This uses Cloudflare's documented [version override](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)
ability to address a version at 0% traffic; it never constructs publication
rows or KV envelopes outside the application. If any staged request cannot be
verified, leave the prior version at 100% and abort before promotion.

## 5. Apply reviewed migrations

Recheck that `dist/release-plan.json` exists and matches the release inputs.
Every guarded mutation first recomputes the deployable artifact manifest. Any
changed, missing, added, or symlinked build artifact aborts the release. The
migration command also compares Wrangler's remote pending list with the exact
names and SHA-256 values in the plan before it can apply anything:

```bash
npm run cloudflare:migrate
```

If the remote list differs, the command stops before mutation. Do not bypass it
with raw Wrangler migration commands.

## 6. Upload and stage the validated version

Use only the guarded upload and deployment commands. They repeat clean/pushed
SHA, attestation, configuration, migration, and release-plan checks:

```bash
npm run cloudflare:upload
npx --no-install wrangler versions list --config dist/server/wrangler.public.json
export RELEASE_WORKER_VERSION='<new version id>'
npm run cloudflare:triggers
```

Do not deploy a dirty or unpushed build and do not weaken Access to make a check
pass.

`versions upload` does not apply routes, Custom Domains, cron schedules, or the
`workers_dev` / preview-URL state. After the apex Studio and owner API
destinations exist in Access, `cloudflare:triggers` runs Wrangler's dedicated
`triggers deploy` command through the same clean-SHA, exact-config, migration,
artifact, and uploaded-version guards. A successful reconciliation writes an
ignored, permission-restricted receipt bound to the release SHA and prepared
configuration. Both staging and promotion reject a missing, stale, or mismatched
receipt. Do not run raw `wrangler triggers deploy` because it would bypass that
binding.

Every release keeps the prior version at 100% and stages the validated version
at 0%:

```bash
npm run cloudflare:stage
npm run cloudflare:checkpoint:snippet
```

Sign in to the production Studio through Access, open the browser developer
console on that same origin, and paste the printed self-contained snippet. It
contains version/content identifiers plus the sanitized approved-provider names
and one-way digest, but no Access token, identity, credential, approval
reference, or provider collection data. Through
`Cloudflare-Workers-Version-Overrides`, the snippet:

1. verifies `/api/studio/health` reached the candidate SHA/content version and
   that campaign version, experience/AI mode, provider/model, Gateway readiness,
   approved provider names, and approval digest exactly match the plan;
2. calls the audited, empty-body Publish route only when the plan recorded
   `predeploy_bootstrap_required`;
3. gets `/api/studio/publication-checkpoint` and requires a `ready` D1/KV
   checkpoint for the release content version; and
4. posts an empty body to owner-only `/api/studio/release-checkpoint`, which
   writes the D1 release marker for this SHA, content version, and current
   publication hash.

A `compatible` plan still runs all staged checks; it skips only the Publish
call. Inspect the snippet result and do not continue unless health, publication,
and release checkpoint all succeed.

## 7. Promote only through the guarded deploy

Promote only after the staged checkpoint succeeds:

```bash
npm run cloudflare:deploy
```

The deploy guard reads the remote D1 release marker and validates it against the
validated SHA, release content version, current D1 publication hash/version,
and the plan's preparation time before it can send the candidate to 100%.
Possession of a version ID or a successful upload is not sufficient.

If publication or release checkpointing cannot be completed or verified, stop
the release with the prior Worker still at 100%. Follow the
[rollback runbook](./rollback.md). Do not bypass the guard, rerun with raw
Wrangler deployment commands, or activate static fallback content.

## 8. Run the exact smoke checklist

Record each of these 14 base checks as pass only after observing it in
production. The six connector-route checks and conditional Travel check follow
the base set:

1. `public_routes`: logged-out `/`, `/work`, `/play`, `/sources`, `/privacy`,
   `robots.txt`, and `sitemap.xml` are available; connector reads are sanitized
   ready/unavailable envelopes.
2. `studio_access`: the owner reaches `/studio/**` and `/api/studio/**` through
   Cloudflare Access.
3. `non_owner_denial`: a logged-out visitor and an authenticated non-owner are
   denied owner routes.
4. `connector_galleries`: each published Play gallery renders its sanitized
   current snapshot and consent-gated third-party content remains deferred.
5. `oauth_callbacks`: configured callback URLs are correct and an invalid or
   unbound callback fails closed without exposing OAuth parameters. Do not begin
   a provider authorization merely to satisfy a release smoke test.
6. `security_headers`: CSP, HSTS, `nosniff`, anti-framing, referrer, and
   permissions headers are present on representative public and protected
   responses.
7. `owner_health`: owner-only `GET /api/studio/health` reports the validated
   release SHA, content version, `COPY_VERSION`, expected latest migration, non-stale
   retention heartbeat, sanitized connector status, and the planned simulation
   contract. For an enabled campaign, Gateway readiness, provider names, and
   approval digest match the plan.
8. `simulation_experience`: when disabled, the ingress is absent and route/APIs
   return their documented unavailable behavior. When coming soon, the ingress
   and noindexed server-rendered route are public, the sitemap omits it, every
   Simulation API is unavailable, and no dossier, session, model, Phaser, or
   Tone code loads. With `campaign-v1`, `/simulation` and the sitemap entry are
   public, Action and Tactical both complete, exactly two optional text moments
   are enforced, AI outage completes through authored fallback, and no
   prompt/response or visitor text appears in logs or storage.
9. `canonical_apex`: the apex is the sole content-serving production origin and
   public HTML, metadata, sitemap, robots, and structured data use it.
10. `www_redirect`: representative `www` paths and queries permanently redirect
   to the equivalent apex URL without dropping either component.
11. `workers_dev_disabled`: the former `workers.dev` hostname no longer serves
    the application.
12. `preview_urls_disabled`: the candidate version has no reachable Worker
    preview URL.
13. `request_id_header`: representative dynamic public, protected, error, and
    host-rejection responses include a fresh `x-request-id`; custom logs remain
    limited to the documented redacted fields.
14. `access_destinations`: both `anish-shah-is.online/studio*` and
   `anish-shah-is.online/api/studio/*` require Access, the owner succeeds, and
   a non-owner remains denied.

My Room is the only Play runtime, so the attestation always requires its six
connector-backed direct-route checks:

15. `play_watch`: `/play/watch` renders Watch and reads only MyAnimeList.
16. `play_read`: `/play/read` renders Read and reads only Hardcover.
17. `play_listen`: `/play/listen` renders Listen and keeps Spotify playback consent-gated.
18. `play_collect`: `/play/collect` renders Collect and the eligible Discogs public state.
19. `play_play`: `/play/play` renders Play and reads only Steam.
20. `play_move`: `/play/move` renders Move and keeps the Strava frame consent-gated.

When Travel is enabled, the attestation additionally requires:

21. `play_travel`: `/play/travel` renders the semantic atlas, loads no
    connector, and serves only media authorized by the active Travel snapshot.

Also verify that `/play` itself performs no connector read before object
selection, the semantic directory works without WebGL, and no inactive provider
or iframe is prefetched. These behaviors are part of the route checks above,
not substitutes for them.

Write down the canonical ISO time at which this checklist completed and the
deployed Worker version ID.

## 9. Write the immutable final attestation

After all checks required by the recorded Play and simulation modes pass:

```bash
export RELEASE_WORKER_VERSION='<deployed version id>'
export RELEASE_SMOKE_TESTED_AT='<canonical ISO timestamp>'
export RELEASE_SMOKE_RESULTS="$(npm run --silent release:smoke:list)"
npm run release:attest
```

`release:attest` rechecks the clean commit and `RELEASE_VALIDATED_SHA`, verifies
that the ignored release plan still matches the content attestation and Worker
configuration, verifies the guarded non-versioned-trigger receipt, and requires
exactly the base, Simulation, connector-route, and enabled Travel smoke
identifiers selected by the release plan. It then
writes a new immutable `releases/<date>-<sha>.json` containing the prior and
current Worker versions, content and copy versions, D1 recovery coordinates,
four validation URLs, trigger reconciliation, domain-cutover evidence, and
simulation settings, sanitized approval digest, and smoke results.

Review and commit the new release record. Never edit or overwrite an earlier
record. If any check fails, do not write a successful attestation; follow the
[rollback runbook](./rollback.md).
