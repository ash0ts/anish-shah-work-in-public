---
name: edit-anish-site-copy
description: Write, shorten, or review visible Anish Shah site language in the existing voice and copy deck. Use for page copy, project notes, speaker material, labels, and evidence presentation. Follow the owner's latest wording and placement choices; pair with the maintenance skill when implementation or source contracts must change.
---

# Edit Anish Site Copy

Write brief, technical, human language for the requested surface. Preserve strong
manual copy and the owner's latest corrections; do not force churn or turn every
page into an article.

## Intent before conventions

The latest explicit user instruction supersedes older plans and presentation
defaults. A request to show a figure on Home means show it visibly—not hide it in
a disclosure or move it to Sources. Preserve honest provenance without inventing
definitions. Do not treat a protected field as a veto on an authorized change.

Choose the actual scope:

- **Review/propose:** return the requested explanation or draft; do not edit.
- **Copy-only:** edit plain text under existing deck headings using trusted
  copy-preview rules.
- **Implement:** for requested layout, new fields, factual updates, or metric
  placement, pair with `$maintain-anish-site` and change the owning contracts in
  the engineering lane. Do not stop at a proposal or ask for the same approval
  again.

Read `AGENTS.md` and inspect `git status` before edits. Reuse a suitable worktree
and preserve unrelated changes.

## Find the source and review class

- [Copy fields](references/copy-fields.md): typed registry, stable markers, field
  ownership. Git-owned prose belongs in `content/copy/**`; never bypass it in
  JSX, generated modules, or D1.
- [Voice](references/voice-and-positioning.md): concrete actor, action, consequence;
  [surface patterns](references/surface-patterns.md): density and current design.
  These are defaults, not immutable slogans or a substitute for the brief.
- [Claims](references/claims-and-evidence.md) and
  [protected boundaries](references/protected-boundaries.md): facts, metrics,
  sources, privacy, consent, and provider meaning.
- [PR workflow](references/pull-request-workflow.md): restricted copy-only preview
  versus ordinary engineering review.

Editorial fields can change directly. Fact-check fields need sanitized evidence
or an explicit owner factual update. New facts enter reviewed curation first;
owner reports must not become independently verified analytics. Keep stable
subjects and evidence associations.

In the copy-only lane preserve markers/headings and use plain text, not HTML,
URLs, code, or templates. An authorized new field updates the typed contract and
generator instead. Metric values, units, source records, routes, visibility,
privacy, provider state, and behavior belong to their owning systems—not an
unrelated editorial field.

## Write for the job

- Prefer concrete nouns and verbs. Remove repeated framing, defensive sourcing,
  database labels, and duplicated conclusions.
- Work: one concrete summary, concise evidenced contribution/impact bullets,
  and demonstrated tools. Omit empty or unsupported sections.
- Home: show the requested measures with precise labels and a brief explanation.
  Full definitions and historical observations belong in Sources. Essential
  provenance stays visible; incomplete definitions are not invented.
- About: preserve the approved personal story. The copyable speaker bio stays
  third person and fact-checked; don't shorten it merely to match card copy.
- Play: keep personality, literal object navigation, attribution, consent,
  update dates, and useful recovery.
- Privacy/Studio: simplify duplication without changing legal, retention,
  deletion, permission, or recovery meaning.
- Apply `write-like-anish` principles to longer prose when available: preserve
  author edits, name the mechanism, cut repetition, read aloud. Article-specific
  narration rules do not force first person or a story arc into UI labels.

Use `frontend-design` with maintenance for authorized hierarchy/interaction
changes. Inspect real narrow and desktop layouts.

## Validate once and hand off

Run `copy:check`, `copy:diff -- --base <ref>`, `copy:audit`, and `copy:test`.
`copy:check` already runs voice validation; don't duplicate it. Add the affected
rendered, metadata, accessibility, and browser checks selected by maintenance,
reusing the candidate build.

Report changed routes, factual provenance, exact results, preview, and remaining
review action. The maintenance skill's `tests/intent-scenarios.md` captures
regression cases for scope, latest instructions, metric visibility, and release
separation.

This skill alone does not authorize deployment, content publication, migrations,
or credentials. If the user explicitly requests a release, use the maintenance
runbook rather than treating copy-only restrictions as a blanket refusal.
