# Content and state

## Canonical content

Four private CSV/Markdown files outside the repository are immutable migration
inputs. `scripts/build-content.mjs` combines them with checked-in public-safe
curation and emits:

- ignored exact owner data under `content/private/`
- the deployable public bundle under `content/public/`
- JSON Schema and the migration-quality report

The importer is deterministic, but a clean GitHub checkout intentionally lacks
the private source files. Full regeneration is therefore an owner operation:

```bash
node scripts/build-content.mjs
npm run verify:content
npm run content:attest:write
npm run content:attest
```

The checked-in public attestation hashes only deployable public content, schema,
and public-safe curation. It exposes no private source hash or local path. Normal
CI verifies this attestation; it does not claim to regenerate private inputs.

## D1 state

D1 stores operational state, never the exact owner bundle:

- sanitized public records and editorial publication snapshots
- encrypted provider credentials
- at most the bounded connector snapshots allowed by provider policy
- short-lived OAuth and promotion transactions
- synchronization and audit history subject to retention

Public reads project only sanitized, published records. Editorial overrides may
change allowlisted presentation fields but not canonical IDs, relations, metric
subjects, raw HTML, or private fields.

## Publication availability

Direct production never restores the entire checked-in bundle when D1 fails or
has no active publication. Publishing follows one ordered transaction boundary:

1. Validate the public projection and stage an immutable, content-addressed
   snapshot in the `PUBLICATION_CACHE` KV namespace.
2. Commit the publication snapshot and its active pointer in one D1 batch.
3. Move the small KV current pointer to the newly staged version.

Normal reads use the active D1 publication. A verified KV version is used only
when D1 cannot provide a valid active publication. If neither store has a valid
snapshot, content-backed routes return a noindexed `503`; the checked-in bundle
is limited to local development and the private reference environment.

## Schema evolution

Migrations under `drizzle/` are forward-only. Use expand/backfill/contract:

1. Add schema that both the current and next Worker can tolerate.
2. Apply and verify the additive migration.
3. Deploy code that can read old and new records safely.
4. Backfill in bounded, observable work.
5. Remove compatibility only in a later release after its rollback window.

Before every remote migration, record a D1 Time Travel bookmark. A Worker
rollback does not revert D1; schema compatibility is what keeps rollback safe.

## Reconciliation

CI applies migrations to a clean local D1 before validation. A release must also
record the public content version and prepared Worker checksum. Do not seed or
copy local D1 into production; production seeding uses only the sanitized
checked-in projection.
