# Content system

The website reads only `public/anish-content.public.v1.json`.

Run the deterministic importer from the project root:

```sh
node scripts/build-content.mjs
node scripts/build-content.mjs --check
```

After a reviewed owner regeneration, update and verify the safe public
attestation:

```sh
npm run content:attest:write
npm run content:attest
```

The attestation hashes only deployable public content, schema, and public-safe
curation. It contains no private source hash or local path. Ordinary CI verifies
the attestation but cannot regenerate the four private inputs.

The four source CSV/Markdown files live one directory above this project and are
treated as immutable inputs. The exact owner bundle is generated under
`content/private/` and ignored by Git. Never copy it into `public/`, application
bundles, media manifests, or deployment assets.

`curation/content-v1.1.json` is the reviewed, public-safe migration layer. It
freezes opaque source-observation IDs, retains legacy ID/slug aliases, records
explicit relation and metric-subject corrections, and defines conservative
Work, Occurrence, Artifact, and Program groups. It may add a public artifact
only when that artifact is explicitly linked from one of the supplied Markdown
sources; it never changes or replaces a CSV observation.

The generated schema is v1.2. `curation/work-groups.v1.json` adds the public
WorkGroup presentation layer without changing canonical entities or legacy
routes. Every `unique_work` entity belongs to exactly one WorkGroup; programs
and references remain separately typed context. `presentation/metric-groups.v1.json`
orders the 13 rounded public measures, while
`curation/public-claim-upgrades.v1.json` records the selected rounded measure
replacements and their immutable source-row selectors.

`presentation/career.v1.json` and
`presentation/work-organizations.v1.json` are reviewed public presentation
contracts, not canonical-content overrides. The career manifest contains only
coarse chronology structure and first-party asset provenance; its prose lives
in the copy deck. The organization manifest may reference only sanitized
organization and WorkGroup IDs with a real evidence intersection. Runtime
resolution removes hidden or empty WorkGroups before rendering and counting.
Neither manifest may introduce new relationships, metrics, dates, or public
records.

The migration report explains current row counts, canonicalization, relation
generation, and privacy checks. Public impact metrics intentionally contain
reviewed display strings instead of raw numeric values. Item-detail selectors
return only explicitly scoped item/entity metrics; collection outcomes are
available through separate collection selectors and are never inherited.
