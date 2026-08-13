# Website copy deck

This directory is the plain-text editing surface for public presentation copy.
It cannot change facts, IDs, routes, URLs, metrics, evidence, relationships,
visibility, ordering, connector policy, privacy language, or application
behavior.

`pages/about.md` owns the About biography and chronology summaries. Those
fields require owner fact-checking; the periods, organization structure, and
brand provenance remain in the reviewed career presentation manifest.
`pages/play.md` owns only room, object, and Travel presentation framing.
`pages/simulation.md` owns only the Simulation invitation, instructions,
nonfactual encounter flavor, and metadata fields declared by the typed
contract. Travel trip facts/media safety and Simulation facts/model/privacy/
safety behavior remain protected owner or engineering surfaces.

## Editing rules

1. Edit only the text below an existing `## field-name` heading.
2. Do not rename headings or the first-line `copy-page` / `copy-record` marker.
3. Do not add Markdown links, HTML, JSX, code, templates, URLs, or local paths.
4. Treat fields reported as `FACT-CHECK` as requiring owner verification.
5. Put layout, interaction, policy, metric, or structural requests in the pull
   request’s implementation-request section instead of this deck.

Run:

```sh
npm run copy:check
npm run copy:diff -- --base origin/main
```

The application generates `.generated/site-copy.ts` before development,
typechecking, linting, tests, and builds. That generated file is intentionally
ignored and must never be edited or committed.

WorkGroup files use a stable ID in their first line. The filename is readable,
but the stable ID is the only join key. The four required fields control only
public display wording. Home derives its line and topic navigation from the
visible archive rather than selecting or renaming individual projects.
