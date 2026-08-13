---
name: edit-anish-site-copy
description: Edit, review, simplify, or propose public-facing wording for the Anish Shah site through its Git-owned copy deck. Use for page headlines, summaries, calls to action, WorkGroup presentation copy, Play object language, metadata, empty states, evidence presentation, or copywriter PRs. Enforces the first-person technical voice, editorial versus fact-check risk classes, protected claims and source records, provider and privacy boundaries, and the engineering-request workflow for changes that cannot be made in copy alone.
---

# Edit Anish Site Copy

Improve the site's language without changing its facts, structure, behavior, or trust boundaries.

## Workflow

1. Read the repository-root `AGENTS.md`, inspect `git status`, and use `$maintain-anish-site` alongside this skill.
2. Trace the visible text to `content/copy/**`. Treat [copy-fields.md](references/copy-fields.md), the typed field registry, and `content/copy/README.md` as authoritative. Do not patch generated copy, canonical content, JSX, or D1 to bypass the deck.
3. Classify every requested change:
   - `editorial`: edit directly within an existing copy field.
   - `fact_check`: edit only when the proposed wording is supported by the sanitized content; flag it for owner verification.
   - protected or structural: do not implement through the deck. Put the proposal in the pull request's **Implementation or visual requests** section.
   Classify what the proposed words say, not only the field that contains them. A factual clause makes the affected field `fact_check`; a protected clause remains protected even inside an otherwise editorial field.
4. Read the applicable reference before drafting:
   - Voice, positioning, terminology, or general editing: [voice-and-positioning.md](references/voice-and-positioning.md).
   - Home, Work, Sources, Play, metadata, error, or empty-state copy: [surface-patterns.md](references/surface-patterns.md).
   - Numbers, factual claims, sources, privacy, consent, provider states, or policy wording: [claims-and-evidence.md](references/claims-and-evidence.md).
   - Protected facts, system behavior, and prohibited edits: [protected-boundaries.md](references/protected-boundaries.md).
   - Branch, pull-request, preview, and owner-review workflow: [pull-request-workflow.md](references/pull-request-workflow.md).
5. Edit only the plain text beneath existing `## field-name` headings. Preserve each `copy-page` or `copy-record` marker and every field heading. Do not add Markdown links, HTML, JSX, code fences, templates, variables, URLs, or executable content.
6. Keep one sentence or element responsible for one job. Remove repeated framing before adding new prose. CTA wording is editorial only when its destination and behavior stay unchanged. When language changes hierarchy or layout, also use `frontend-design` and route the request through engineering; loading that skill does not authorize copywriters to edit JSX, CSS, routes, or behavior.
7. Validate from the repository root:

   ```sh
   npm run copy:check
   npm run copy:voice
   npm run copy:diff -- --base <ref>
   npm run copy:audit -- --base <ref>
   npm run copy:test
   ```

   If a command is not present on the current branch, report that integration dependency rather than substituting an unreviewed tool.
8. Review every affected route at narrow and desktop widths. Check wrapping, visible and accessible label agreement, metadata alignment, and repeated information.
9. Follow the copy-only pull-request and synthetic-preview workflow, then report changed copy keys, routes, risk classes, fact-check items, validation results, and any implementation request that remains.

## Ownership Boundaries

### Edit directly

- Page framing, section introductions, calls to action, nonbehavioral labels, search placeholders, no-results text, and 404 wording. On Home this includes the signal/rail headings and method CTA, not the protected signal or rail mapping.
- Play object flavor text, including the Globe/Travel doorway. Literal object names and categories are fixed by the seven-object registry.
- Dormant Simulation introduction, CTA, nonfactual encounter flavor, and accessibility-friendly instructions through declared `content/copy/pages/simulation.md` fields. Editing them does not expose the disabled route or authorize activation.
- SEO and social descriptions when they remain consistent with visible copy and structured data.

### Edit with owner fact-check

- Profile positioning and current-focus language.
- WorkGroup display titles, short titles, summaries, and role summaries.
- Wording that mentions dates, organizations, roles, scope, attribution, product behavior, or technical capability.
- An explicitly registered citation display label that preserves the immutable source title in accessible detail. No citation-label field is currently registered; request one through engineering before proposing this edit.

For WorkGroup factual copy, resolve the `copy-record` stable ID against the sanitized public bundle. Record the canonical subject and evidence IDs that support the clause. If it cannot be resolved there, do not add it.

### Never change through copy

- Metric values, labels, qualifiers, periods, scope, attribution, source labels, or evidence associations.
- The reviewed `home-signal-rails.v1.json` metric IDs, compact limits, icon IDs,
  bucket IDs, topic IDs, and ordering. They require an engineering change,
  owner review, `COPY_VERSION`, and attestation updates.
- IDs, slugs, aliases, routes, links, ordering, visibility, relationships, group membership, or featured state.
- Source titles, publishers, URLs, event dates, bibliography records, generated bundles, schemas, attestations, or private inputs.
- Privacy, retention, deletion, consent, provider attribution, OAuth, security, legal, synchronization, error-state semantics, or public-payload contracts.
- Travel trip titles, dates, place labels, captions, tags, geography precision, photo safety wording, and media policy. Those remain owner-authored/fact-controlled in Travel Desk.
- Simulation disclosure, factual cards, metrics, model/provider policy, system prompts, safety behavior, budgets, session rules, fallback behavior, and provider approvals.
- Purely programmatic accessible names, button behavior, or other interaction contracts.

Do not weaken a protected statement to make prose smoother. Propose the desired outcome and explain why in the pull request instead.
A short citation label would require a separate registered presentation field; none exists today. It may never replace the immutable title, and its future implementation must keep that exact title in accessible detail.

## Engineering-Request Workflow

When copy implies a new layout, interaction, route, field, fact, policy, or behavior:

1. Keep the copy-only change limited to allowed deck files.
2. Describe the request in **Implementation or visual requests**, including the affected route, user outcome, proposed language, and acceptance criteria.
3. Let the owner add implementation commits to the same PR, which converts it to the normal full-code workflow, or open a linked engineering PR.
4. Stop treating the change as copy-only as soon as code, configuration, workflows, migrations, generated output, or protected content changes.

Never deploy, migrate, publish, rotate credentials, or mutate production from this skill.
The engineering-request workflow is not an approval path for changing protected facts. Layout may change only while the complete canonical value, period, scope, attribution, qualifier, and source remain adjacent.

For each fact-check field, report its copy key, stable subject ID, proposed factual clause, supporting sanitized fact or evidence ID, and owner-review status.
