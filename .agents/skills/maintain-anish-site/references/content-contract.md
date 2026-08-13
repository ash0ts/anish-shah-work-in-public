# Content and Copy Contract

## Canonical Authority

1. Four owner-held CSV/Markdown inputs are immutable observations.
2. `content/curation/content-v1.1.json` owns stable observations, aliases, relations, corrections, and conservative grouping.
3. `content/curation/work-groups.v1.json` owns WorkGroup membership and structure.
4. Reviewed claim, metric, and Home signal/rail presentation files own
   approved quantitative claims, compact limits, icon identities, and
   bucket/topic navigation.
5. `scripts/build-content.mjs` deterministically generates owner/public bundles, schema, report, and attestation.
6. `content/public/anish-content.public.v1.json` is the only checked-in canonical public bundle imported by the application.

Do not hand-edit generated bundles, schemas, attestations, or reports. Complete regeneration requires owner-held inputs; a clean clone can build the site but cannot truthfully recreate source migration history.

## Presentation Precedence

1. The sanitized canonical bundle supplies facts, IDs, relations, metrics, evidence, URLs, and structure.
2. Published D1 state controls allowlisted visibility, ordering, caveats, and owner metric wording.
3. `content/copy/**` supplies only declared page and WorkGroup presentation fields.

`CONTENT_VERSION` identifies canonical data. `COPY_VERSION` hashes every copy
source, field contract, parser/generator, and the reviewed
`content/presentation/home-signal-rails.v1.json` manifest. The public content
attestation also inventories that manifest. Record both versions in preview
metadata, owner health, release plans, and attestations.

## Copy Ownership

Copywriters may directly edit declared narrative, framing, CTA, navigation, metadata, room flavor, and non-behavioral labels. WorkGroup/profile/methodology prose is fact-check risk and requires owner verification.

The copy deck cannot own metrics, evidence, dates, IDs, slugs, relationships,
URLs, ordering, visibility, privacy/security/legal language, provider
attribution/policy, connector payloads, states, behavior, generated data, or
the Home signal/rail mapping and compact limits. Those belong in a proposal or
linked engineering change. Use `$edit-anish-site-copy` for copy-only work.

The parser rejects unknown/duplicate/missing headings, altered stable-ID markers, HTML, JSX, scripts, code fences, embedded links, control characters, private paths/domains, and field-length violations. Copy renders as plain React text; Markdown is never interpreted.

## Privacy and Attribution

- `content/private/anish-content.v1.json` and raw inputs remain owner-only, ignored, and undeployed.
- Never expose exact private values, internal evidence, local paths, raw notes, provider payloads, private names, or internal URLs in copy, D1, metadata, tests, logs, screenshots, or previews.
- Public metrics retain approved display strings plus scope, attribution, period, qualifier, subject, and evidence.
- Outcome selectors show only directly scoped metrics. Program/portfolio context requires explicit mapping and a separate label.
- Occurrences, recordings, translations, mirrors, references, and source observations cannot inflate unique-work totals.

## Stable Identity and Workflow

- Correcting title/date/URL never changes an opaque ID; previous slugs remain aliases.
- Never merge on title alone. Require canonical URL, typed relation, or reviewed corroborated override.
- Every archive-visible entity belongs to one WorkGroup or has a documented nested/context-only decision.
- Canonical changes run the generator, content verification/tests, privacy review, and attestation review.
- Copy changes run `copy:check`, `copy:diff -- --base <ref>`, `copy:test`, rendered checks, and affected-route browser review.
