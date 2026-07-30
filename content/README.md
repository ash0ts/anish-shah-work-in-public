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

The migration report explains current row counts, canonicalization, relation
generation, and privacy checks. Public impact metrics intentionally contain
reviewed display strings instead of raw numeric values.
