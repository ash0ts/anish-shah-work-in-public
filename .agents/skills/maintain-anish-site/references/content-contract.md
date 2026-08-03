# Content Contract

## Authority Order

1. Four immutable CSV/Markdown source files live one directory above the repository.
2. `content/curation/content-v1.1.json` records stable observation IDs, aliases, relations, corrections, and conservative canonical grouping.
3. `content/curation/work-groups.v1.json` defines the public WorkGroup presentation layer.
4. `content/curation/public-claim-upgrades.v1.json` records reviewed rounded claim replacements and immutable source selectors.
5. `content/presentation/metric-groups.v1.json` orders approved public measures.
6. `scripts/build-content.mjs` deterministically generates the owner bundle, public bundle, schema, and migration report.
7. `content/public/anish-content.public.v1.json` is the only canonical content bundle imported by the application.

Do not hand-edit generated bundles, schemas, or migration reports. Change the owning curation/presentation input or importer, then regenerate.

## Privacy Boundary

- `content/private/anish-content.v1.json` is owner-only, ignored by Git, and excluded from builds and deployment.
- Never copy exact private values, internal evidence, local paths, provider payloads, private names, raw notes, or internal URLs into public content, D1 editorial records, metadata, tests, logs, or screenshots.
- Public impact metrics use approved display strings and explicit scope, attribution, period, qualifier, subject, and evidence.
- Item outcome selectors may return only directly scoped metrics. Program or portfolio context requires an explicit mapping and separate label.
- Source observations, occurrences, artifacts, translations, mirrors, and references must not inflate unique-work totals.

## Stable Identity and Grouping

- Preserve opaque IDs when correcting a title, date, URL, or organization.
- Preserve previous slugs as aliases and keep legacy redirects working.
- Do not merge records by title alone. Require an exact canonical URL, an existing typed relation, or a reviewed curation override corroborated by evidence.
- Keep source titles and observations immutable in the owner bundle. Curate separate public display and short titles.
- Assign every archive-visible entity to one WorkGroup or document why it remains nested or context-only.

## Content Workflow

1. Confirm all four external inputs are present. If not, report that regeneration is unavailable; never fabricate or copy private inputs into the repository.
2. Edit only the owning curation, presentation, or importer file.
3. Run:

   ```bash
   node scripts/build-content.mjs
   npm run verify:content
   npm run test:content
   ```

4. Review the generated migration report and diff. Investigate changed counts, IDs, slugs, relations, exclusions, metrics, or evidence rather than accepting churn.
5. Run privacy and rendered checks before handoff when changed content appears publicly.

The checked-in public bundle enables application builds in a clean clone, but complete regeneration depends on owner-held inputs outside the repository. Treat that limitation explicitly; do not claim CI reproduces the migration from raw sources.
