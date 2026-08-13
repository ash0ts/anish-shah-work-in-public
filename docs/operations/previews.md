# PR previews

This is the canonical contract for synthetic, Access-protected pull-request
previews and their visual-review evidence. Preview resources never join the
staging or production promotion path. See [Staging releases](./staging.md) for
live-provider and hosted acceptance.

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
preview CI service token. Preview Workers contain no D1, KV, R2, encryption,
provider, cron, Studio, write, promotion, or OAuth capability. The Worker
accepts a verified Access service principal only in preview; it never grants
owner authorization.

Simulation is disabled in public previews. The Play doorway is absent,
`/simulation` and its public APIs return 404, and no Simulation client bundle,
Gateway request, session row, provider read, or approval state is used. A future
campaign-specific branch must deliberately reintroduce an isolated fixture
contract before preview gameplay can become review evidence again.

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
Use `/play/<object>?fixture=<scenario>` in the exact preview tier. The `/play`
overview remains provider-free and never forwards a fixture to inactive
objects. Ready
fixtures include neutral first-party placeholder artwork, while
`missing-artwork` deliberately omits the artwork contract.

Every staging and preview response includes
`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`.
Their `robots.txt` disallows all crawling, no staging/preview sitemap is
advertised, browser titles identify the tier, and dynamic responses are
`private, no-store`. Access protection is required but is not treated as the
only indexing control.

Travel previews use synthetic trip records and first-party placeholders. They
cannot upload, publish, read R2, or reach owner Studio. Real photo ingestion,
metadata stripping, atomic publication, and media authorization are staging
acceptance work. No media or Travel record is promoted between environments.

## Visual review evidence

The Browser quality workflow produces a 14-day `room-browser-review-<SHA>`
artifact for each tested commit. It contains an interaction recording and
synthetic screenshots for:

- The static poster and neutral interactive room.
- All four authored rotation bounds.
- Each of the seven focused room objects, including Postcard Planet.
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
