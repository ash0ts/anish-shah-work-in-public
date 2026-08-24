# Copywriting workflow

This is the freelancer-facing guide for changing public wording without editing
application code or gaining access to Studio, credentials, provider data, or
deployment systems.

The editing surface is [the copy deck](../content/copy/README.md):

```text
content/copy/
  pages/site.md
  pages/home.md
  pages/about.md
  pages/work.md
  pages/play.md
  pages/simulation.md
  pages/sources.md
  work-groups/<readable-slug>.md
```

Copywriters and their LLMs should use the repository-local
[`$edit-anish-site-copy` skill](../.agents/skills/edit-anish-site-copy/SKILL.md).
Application maintainers use `$maintain-anish-site`.

## What to edit

Each file has a fixed marker and fixed `## field-name` headings:

```md
<!-- copy-page: home -->

## seo-title
Applied AI, in public
```

```md
<!-- copy-record: group:products:wandb-mcp -->

## display-title
W&B MCP Server
```

Edit only the plain text below an existing heading. Do not rename, add, remove,
or reorder headings, and do not change either marker. WorkGroup filenames are
for people; the immutable marker is the join key.

The parser deliberately rejects Markdown links, URLs, HTML, JSX, code fences,
scripts, templates, imports, variables, control characters, local/private
paths, internal domains, and quantitative metric-shaped wording. Copy renders
as React text, never as interpreted Markdown or HTML.

## Editorial risk levels

### Editorial

These fields may be changed directly, subject to tone, length, layout, and
accessibility review:

- Home framing and CTA labels;
- About headings, speaker-profile labels, and CTA labels;
- Work and Play introductions;
- room overview and object flavor text;
- Travel atlas framing and Simulation invitation, instructions, and nonfactual encounter flavor through declared fields;
- search placeholders and non-behavioral labels;
- 404 text;
- page titles and SEO/social descriptions; and
- visible header/footer wording without changing destinations.

### Fact-check

These fields may be edited, but the owner must verify every factual implication
before approval:

- profile headline, summary, and current-focus language;
- About biography, speaker bio, and speaker topics;
- WorkGroup display title, short title, summary, and role summary;
- career trajectory and bucket descriptions;
- Sources methodology, counting-rule, and non-claim prose; and
- statements about dates, organizations, scope, attribution, roles, or product capabilities.

`npm run copy:diff` reports changed keys and marks each `EDITORIAL` or
`FACT-CHECK`. A fact-check label is a review requirement, not permission to
change canonical facts.

The About chronology is not a copy-deck surface. Its periods, organization
names, trajectory labels, and brand references live in the reviewed
`content/presentation/career.v1.json` manifest. Propose chronology changes as
an engineering and fact-review request rather than adding new About fields.

## Speaker-profile exception

Most personal narrative uses Anish's first person only when authorship or a
personal choice matters. The `about.speaker-bio` field deliberately uses third
person so an event organizer can copy it without rewriting pronouns. Keep it
fact-checked, grounded in the public Work archive, and useful as a standalone
organizer bio. Short paragraphs are allowed when they improve scanning.

The three speaker-topic labels and descriptions are also fact-check fields. They describe
demonstrated subject areas and link into the existing Talks/Programs Work
filters; they cannot create a credential, talk count, award, or new claim. The
speaker eyebrow, topics heading, and CTA labels are editorial. The LinkedIn
destination is resolved from the sanitized public profile and is not editable
copy.

| Review class | About fields |
| --- | --- |
| Fact-check | `speaker-heading`, `speaker-bio`, the three `speaker-topic-*` labels, and their three `speaker-topic-*-description` fields |
| Editorial | `speaker-eyebrow`, `speaker-topics-heading`, `speaker-copy-cta`, `speaker-work-cta`, `speaker-linkedin-cta` |

The owner-only Studio copy report lists this page path, its route scope, and
the current counts for both review classes. It is an inventory, not another
editing surface.

## Voice review

For a full language pass, review the claim and structure first. Then replace
abstract nouns and vague verbs with the actual actor and action, cut repeated
framing, and read the result aloud. Keep strong existing copy rather than
rewriting it for consistency alone.

Avoid template openings such as “A session…,” “A meetup talk…,” and “Two
upstream changes…”. Replace vague verbs such as “mapped,” “connected,”
“explored,” and “extended” when the evidence supports a more exact mechanism.
Mild personality belongs in Play; speaker copy, Privacy, consent, and recovery
messages stay literal.

## Protected: request, do not edit

The deck cannot change:

- metric value, label, qualifier, period, scope, attribution, or evidence;
- Home signal compact limits, metric/icon IDs, line/topic IDs, and ordering in
  `content/presentation/home-signal-rails.v1.json`;
- IDs, slugs, aliases, URLs, relationships, WorkGroup membership, order,
  visibility, or featured state;
- dates, evidence/bibliography records, source titles, or canonical data;
- privacy, retention, deletion, consent, OAuth, provider attribution, security,
  or legal language;
- connector payload fields, coverage literals, synchronization/error states,
  routes, button behavior, or programmatic accessible names; or
- generated bundles, schemas, attestations, migrations, credentials, workflows,
  deployment code, or Studio.

Travel trip titles, dates, place labels, captions, tags, geography precision,
photo-safety decisions, and media policy are owner/fact-controlled in Travel
Desk. Simulation disclosure, factual cards, metrics, model/provider policy,
system prompts, safety behavior, budgets, session rules, fallback behavior, and
provider approvals are likewise protected. Copywriters may propose changes to
those surfaces, but they cannot implement them through an editorial field.

Simulation is disabled for the v2.2 preview and release: there is no Play
invitation, sitemap entry, route/API response, or client bundle. Its copy-deck
fields remain dormant and do not authorize activation.

Describe one of these changes in **Implementation or visual requests** in the
copy PR template. The owner can add an engineering commit, which moves the PR
out of the trusted copy-only lane, or open a linked engineering PR.

## GitHub web-editor workflow

GitHub Pro branch protection must be verified before the owner grants a
copywriter repository write access. The expected policy requires a PR, one
owner/CODEOWNER approval, stale-approval dismissal, resolved conversations,
required checks, and no direct/force pushes or branch deletion.

For a copy-only change:

1. Open the target file on GitHub and choose **Edit**.
2. Change only text under existing headings.
3. Create a new branch; never commit directly to `main`.
4. Open a PR using `.github/PULL_REQUEST_TEMPLATE/copy-change.md`.
5. Complete audience, before/after, fact-check, SEO, implementation-request,
   and preview sections.
6. Wait for copy validation and the trusted synthetic preview.
7. Check that the preview comment names the current exact SHA and
   `COPY_VERSION`; an older or failed preview is stale.
8. Review every affected route at narrow and desktop widths, including wrapping,
   visible/accessibility-name agreement, metadata, and missing/long fixture states.
9. Obtain owner fact-check and CODEOWNER approval before merge.

If any non-copy file changes, the trusted copy-only workflow stops. The PR must
use the normal engineering checks and an owner-approved preview environment.

## Local workflow

Local tooling is optional for a copywriter using the GitHub editor. When it is
available:

```bash
npm ci
npm run copy:generate
npm run copy:check
npm run copy:diff -- --base origin/main
npm run copy:test
npm run dev
```

`.generated/site-copy.ts` is ignored, regenerated before development/tests/
builds, and must never be committed or edited. `COPY_VERSION` deterministically
hashes every deck file, the field contract, parser/generator, and reviewed Home
signal/rail manifest. It appears in preview metadata, owner health, release
plans, and attestations; canonical `CONTENT_VERSION` is separate. The same Home
manifest is also inventoried in the public content attestation.

## Trusted preview model

The unprivileged PR job first proves that every changed path is an approved copy
source or copy PR metadata and packages only bounded UTF-8 text. A privileged
follow-up then checks out trusted base-branch code, reapplies only that validated
text, validates again, builds the synthetic fixture preview, and captures
affected-route screenshots.

The preview receives no D1, KV, provider network, OAuth, credentials, Studio,
cron, production data, or write APIs. Access is limited to the owner, approved
reviewers, and its smoke-test service principal. The persistent comment reports
the exact SHA, `COPY_VERSION`, risk classes, routes, screenshot coverage, and
status. See [PR previews](./operations/previews.md).

## Ownership after merge

Canonical sanitized content remains the factual and structural authority. D1
continues to own visibility, ordering, caveats, metric wording, and publication
state. The copy deck owns only declared presentation fields. Studio shows those
Git-owned fields read-only with their source path; retained D1 WorkGroup wording
is reported for review but ignored. See
[Content and state](./architecture/content-and-state.md).
