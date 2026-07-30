# Content system

The website reads only `public/anish-content.public.v1.json`.

Run the deterministic importer from the project root:

```sh
node scripts/build-content.mjs
node scripts/build-content.mjs --check
```

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

The migration report explains current row counts, canonicalization, relation
generation, and privacy checks. Public impact metrics intentionally contain
reviewed display strings instead of raw numeric values. Item-detail selectors
return only explicitly scoped item/entity metrics; collection outcomes are
available through separate collection selectors and are never inherited.
