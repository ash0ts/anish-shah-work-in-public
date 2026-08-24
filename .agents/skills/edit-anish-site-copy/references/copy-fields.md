# Copy Fields

## Editable Sources

- `content/copy/pages/site.md`: navigation, footer, global labels, and shared metadata wording.
- `content/copy/pages/home.md`: homepage framing, signal/rail headings, calls to action, and homepage metadata. The signal values, compact limits, icons, and line/topic mapping are protected elsewhere.
- `content/copy/pages/about.md`: concise biography, copyable speaker-profile prose, calls to action, and About metadata. The separate career manifest owns chronology periods, organizations, and trajectory labels.
- `content/copy/pages/work.md`: Work archive introduction, search wording, and metadata.
- `content/copy/pages/play.md`: room overview, seven object descriptions, Travel doorway/atlas framing, and Play metadata.
- `content/copy/pages/simulation.md`: dormant Simulation introduction, CTA, nonfactual encounter flavor, instructions, and metadata. Editing it does not enable the route.
- `content/copy/pages/sources.md`: Sources framing and approved methodology prose.
- `content/copy/work-groups/<slug>.md`: one stable WorkGroup's display title, short title, summary, and role summary.

Only edit the text between fixed headings. A field may be one line or multiple paragraphs according to the registry; validation reports the exact rule when a draft is too long or paragraph-incompatible.

About's speaker fields divide cleanly by review class:

- Fact-check: `speaker-heading`, `speaker-bio`,
  `speaker-topic-agent-systems`,
  `speaker-topic-evaluation-observability`, and
  `speaker-topic-education-community`.
- Editorial: `speaker-eyebrow`, `speaker-topics-heading`,
  `speaker-copy-cta`, and `speaker-linkedin-cta`.

The topic destination IDs and LinkedIn URL are not copy fields.

## Editorial Fields

These usually accept direct copy review:

- Page framing and section introductions.
- Current-focus prose and CTA wording.
- Room/object flavor text.
- Search placeholders and non-behavioral visible labels.
- 404, navigation, footer, SEO title, and social description wording.

Do not change a destination, action, route, or accessible behavior merely because its visible label is editable.

## Fact-Check Fields

Owner verification is required for:

- Profile headline and summary.
- WorkGroup display title, short title, summary, and role summary.
- Career trajectory and methodology/counting prose.
- About biography, speaker bio, and demonstrated speaker-topic wording. The speaker bio deliberately uses third person so an organizer can reuse it directly.
- Any statement naming dates, organizations, scope, attribution, product behavior, or technical capability.

`npm run copy:diff -- --base <ref>` groups changed keys by risk and affected route. Treat `fact_check` as a review requirement, not a suggestion.

## Fixed Syntax

Keep these exact:

```text
<!-- copy-page: home -->
## hero-headline
<!-- copy-record: group:products:wandb-mcp -->
```

The marker binds a human-readable file to a stable sanitized record. Changing it is a structural/data change and the parser rejects it.

Literal Play object names are also structural. The copy deck exposes their fields so generation stays centralized, but validation pins them to TV, Bookshelf, Music player, Record crate, Computer, Treadmill, and Globe. Edit the adjacent descriptions and screen framing instead.

Home's protected `content/presentation/home-signal-rails.v1.json` is not an
editable copy source. Request changes to its metric IDs, compact limits, icon
IDs, bucket/topic IDs, or ordering through engineering and owner review.
