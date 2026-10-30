# Content, copy, and runtime state

## Canonical public facts

Four private CSV/Markdown files outside the repository are immutable migration
inputs. `scripts/build-content.mjs` combines them with checked-in public-safe
curation and emits:

- ignored exact owner data under `content/private/`;
- the deployable sanitized bundle under `content/public/`;
- the public JSON Schema and migration-quality report; and
- a checked-in attestation over deployable public artifacts only.

A clean CI checkout intentionally lacks the private inputs, so full regeneration
is an owner operation. Normal CI verifies byte identity against the safe
attestation; it does not claim to rebuild the private source corpus.

Never hand-edit the generated public JSON. Stable IDs, aliases, relations,
WorkGroups, metric subjects, and evidence are canonical-data concerns, not copy
deck or Studio concerns.

Reviewed additions live in `content/curation/portfolio-updates.v1.json`.
The versioned input carries an explicit review date, item date basis and status,
optional public artifact URL, stable entity/group memberships, and dated metric
observations. It extends the archive without editing the four original inputs.
Merge or article-update dates use an unknown date basis with an explicit status;
they are not relabelled as publication or delivery dates. Review freshness never
backdates or advances an older observation.

Approved internal contributions use public owner-authored descriptions and a
method note, not private repository URLs or corroborating excerpts. Pages with
no public artifact say “Materials not public.” Supporting articles, labs, and
pull requests remain inside one project. Optional fact-checked `detail-note`
copy explains contribution boundaries in the existing Sources disclosure.

Metric additions and active-claim replacements require dated observations,
reviewed display values, units, scope, attribution, qualifiers, and source
selectors. Replacement changes the active public claim, not the historical
owner observations. Unresolved measurements stay out of deployable content.

## Copy deck

`content/copy/` is the only freelancer-facing wording surface. Its fixed-field
Markdown is parsed as plain text: no Markdown rendering, HTML, JSX, links,
templates, imports, variables, or executable content. WorkGroup files join
through immutable stable-ID markers, never filenames or titles.

Generation writes the ignored `.generated/site-copy.ts`. `COPY_VERSION` is a
deterministic digest of every deck file, the field contract, the parser and
generator implementation, and the reviewed
`content/presentation/home-overview.v2.json` manifest. It is recorded in
preview metadata, owner health, staging/production plans, and immutable release
attestations. It changes presentation wording and protected Home navigation
presentation without changing canonical `CONTENT_VERSION`.

The Home manifest is also inventoried by the public content attestation. It
owns the three signal metric IDs, compact limits, icon IDs, and the four
bucket/illustration mappings. Those values are owner-reviewed engineering data,
not freelancer copy fields.

## Ownership and precedence

The four sources have disjoint authority:

1. **Canonical sanitized content** supplies facts and structure: IDs, routes,
   dates, relationships, metrics, evidence, and WorkGroup membership.
2. **Reviewed presentation manifests** supply narrow protected mappings such as
   Home signal metrics/limits/icons and illustrated work-type areas.
3. **Published D1 state** supplies visibility, ordering, caveats, featured
   state, owner-approved metric wording, and publication state.
4. **Git-owned copy deck** supplies only declared page and WorkGroup
   presentation fields.

For WorkGroup wording moved to Git, retained D1 title/summary values are listed
for owner review but ignored. A D1 caveat still composes with the Git-owned
summary. Studio presents Git-owned fields as read-only with their copy-deck
path; it remains authoritative for metrics, caveats, visibility, and ordering.
No D1 migration is required for this ownership change.

## D1 and KV publication

D1 stores operational state, never the exact owner bundle. Publishing uses one
ordered boundary:

1. validate the sanitized projection and stage an immutable, versioned snapshot in KV;
2. commit the D1 publication snapshot and active pointer in one batch; and
3. advance the small KV current pointer only after D1 succeeds.

Normal hosted reads use the active D1 publication. A cryptographically and
structurally verified KV version is used only when D1 cannot provide a valid
active publication. If neither store is valid, production and staging return a
noindexed `503`. The checked-in bundle is an explicit local, synthetic-preview,
and private-reference input; it is never an automatic direct-production
fallback.

## Connector state

Provider responses are untrusted until exact normalization and public
projection succeed. D1 stores encrypted credentials, bounded sanitized
snapshots, short-lived OAuth/promotion transactions, sync history, and audit
state. Public routes expose only allowlisted response contracts and are pure
reads: they never initiate synchronization. The same is true of OAuth
callbacks, credential saves, and scheduled maintenance. Only an explicit owner
Studio Refresh may fetch provider collection data. Disconnect deletes and
unpublishes according to the connector contract; a failed refresh preserves
the stored snapshot and active pointer while its provider-specific public-age
and privacy policy still applies.

See [Play connections](../play-connections.md) for provider-specific freshness,
publication, and recovery rules.

## Schema evolution and recovery

Migrations under `drizzle/` are forward-only. Use expand/backfill/contract so
the previous and candidate Workers remain compatible through the rollback
window. Record a D1 Time Travel bookmark before every remote migration. Worker
rollback does not restore D1.

CI applies all migrations to a fresh local D1. Never copy local D1 to staging or
production, and never build publication rows or KV envelopes manually. Use the
application’s audited publish path and the [release runbook](../operations/release.md).
