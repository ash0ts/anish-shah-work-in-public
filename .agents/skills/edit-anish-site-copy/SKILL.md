---
name: edit-anish-site-copy
description: Edit or review plain-text public presentation copy for the Anish Shah site through its Git-owned Markdown copy deck. Use for homepage, Work, Play, Sources, navigation, footer, SEO, room flavor, 404, profile, methodology, or WorkGroup wording, and for preparing a copy-only pull request or implementation request. Keeps facts, metrics, evidence, privacy, provider policy, routes, behavior, generated files, secrets, and deployment code protected.
---

# Edit Anish Site Copy

Improve public wording without changing facts, structure, behavior, security, or deployment.

## Workflow

1. Read [copy-fields.md](references/copy-fields.md) and choose the existing field(s) that own the requested surface.
2. Edit only text beneath existing `## field-name` headings in `content/copy/pages/*.md` or `content/copy/work-groups/*.md`.
3. Never rename, add, remove, reorder, or duplicate headings. Never change `copy-page` or `copy-record` comments.
4. Keep copy plain text. Do not add Markdown formatting, links, HTML, JSX, code, variables, templates, imports, or instructions to the application.
5. Separate direct editorial wording from factual wording that needs owner verification. If the request touches a protected field or layout/behavior, put it in the PR implementation-request section instead of changing code or data.
6. Run or ask the owner/CI to run:

   ```bash
   npm run copy:check
   npm run copy:diff -- --base origin/main
   npm run copy:test
   ```

7. Follow [pull-request-workflow.md](references/pull-request-workflow.md), inspect the synthetic preview at all affected routes, and resolve factual review before merge.

## Copy Quality

- Lead with the idea a technical reader should retain, then supply only necessary context.
- Prefer specific, evidence-compatible language over superlatives, jargon, or vague impact claims.
- Preserve distinctions such as enrollments versus learners, attendance versus registration, pipeline supported versus revenue, and public artifact versus unique work.
- Keep titles, CTAs, labels, and metadata within their existing field limits. Do not compress a factual qualification out of meaning.
- Read the result at 320px and with a screen reader mindset: visible labels must still make sense without surrounding visual effects.

## Stop and Request Engineering

Do not edit application code, JSON, IDs, links, routes, data, generated output, workflows, Studio, connectors, security, migrations, or deployment files. Use [protected-boundaries.md](references/protected-boundaries.md) whenever a request might affect facts or system behavior.

For layout, hierarchy, interaction, additional fields, destinations, accessibility behavior, or new content structures, describe the intended outcome and affected surface in the copy PR's implementation-request section. The owner can add reviewed engineering commits or open a linked engineering PR; that change leaves the copy-only trusted lane.
