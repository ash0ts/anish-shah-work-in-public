# Website copy deck

This directory is the plain-text editing surface for public presentation copy.
It cannot change facts, IDs, routes, URLs, metrics, evidence, relationships,
visibility, ordering, connector policy, privacy language, or application
behavior.

`pages/about.md` owns the About biography, speaker-profile prose, headings,
and calls to action. Biography, speaker bio, and speaker topic labels and
descriptions require owner fact-checking. The reviewed career presentation manifest—not the copy
deck—owns chronology periods, organizations, trajectory labels, and brand
provenance. The speaker bio is the one deliberate third-person exception to
the site's personal narrative voice because event organizers need copy that
can be reused without rewriting it. The speaker bio may use short paragraphs;
the application copies those paragraphs, grounded topic descriptions, and the
sanitized LinkedIn URL as one organizer-ready profile.
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
public display wording. Home's four illustrated work types link to the visible
archive without counts, topic shortcuts, or representative-project selections.

The optional `detail-note` field adds a fact-checked contribution or experiment
limit inside the project's collapsed Sources section. It is not a second
summary, private evidence dump, or place for unreviewed metrics. Canonical status
and artifact availability remain data-owned; missing private materials must not
be represented as broken links.
