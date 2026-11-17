---
name: maintain-anish-site
description: Implement, diagnose, validate, or release changes in the Anish Shah site repository. Use for application code, content contracts, providers, infrastructure, CI, gear/Equipboard reconciliation, and repository documentation. Follow the current user request while preserving private-data boundaries and guarded release mechanics; use the copy skill for public wording.
---

# Maintain Anish Site

Implement the requested outcome using the site's existing architecture. A skill
helps complete the task; it does not substitute a different product or add
approval loops.

## Start from current intent

- Read `AGENTS.md` and `git status`; preserve unrelated work and manual edits.
- The latest explicit user instruction supersedes older plans and repository
  presentation defaults. Update source contracts and tests with the correction.
  Do not silently restore an earlier choice.
- Distinguish review, implementation, preview, and release. A review does not
  authorize writes; an implementation request does authorize its normal scoped
  code/content changes. Release authorization does not authorize unrelated data,
  credential, or provider changes.
- Protected means change through the owning source with appropriate checks—not
  refuse an owner-authorized change. Do not hide requested figures because a
  definition is incomplete; preserve honest owner-reported provenance and leave
  unknown definitions unknown.
- Ask only when missing information materially blocks the outcome or new
  authority is needed. Explain a concrete security/privacy conflict and continue
  unaffected work.

## Read the relevant reference

- Code ownership, UI, Room/Pocket Room, Travel, Simulation, or assets:
  [repository map](references/repository-map.md). Use `frontend-design` for
  visual/interaction work; inspect the current site rather than imposing a
  generic aesthetic.
- Canonical facts, WorkGroups, metrics, presentation manifests, or publication:
  [content contract](references/content-contract.md).
- Public words: pair with `$edit-anish-site-copy`. Authorized layout, new fields,
  or metric placement uses the engineering lane, not a copy-only handoff.
- Connectors, Studio, OAuth, hosted environments, security, or production:
  [connector and release boundaries](references/connectors-security-release.md).
- Guitar inventory, missing Equipboard entries, or collection comparison:
  [gear collection workflow](references/gear-collection.md).
- Tests and delivery: [validation matrix](references/validation-matrix.md).
  Human-readable architecture is in `docs/architecture/codebase-tour.md`;
  production procedure is in `docs/operations/release.md`.

Read only references relevant to the task. Do not re-copy their inventories into
every plan or final answer.

## Implement and validate proportionally

1. Trace the owning source. Edit curation, the copy deck, presentation manifests,
   server policy, or application code—not generated JSON, D1/KV envelopes, or
   client output. Regenerate dependent content, copy, and attestations.
2. Implement the smallest coherent change. Preserve stable URLs, hidden-work
   filtering, factual boundaries, semantic HTML, and relevant accessibility.
   Add behavior-level coverage for repaired invariants.
3. Classify committed and local changes:
   `node .agents/skills/maintain-anish-site/scripts/check-change.mjs --plan --base origin/main`.
   Run the selected affected checks with `--run`. A final handoff alone is not
   a reason for `--full`; broad runtime/security/dependency changes may be.
4. Build once per candidate; reuse exact artifact/configuration/suite-bound
   evidence. `copy:check` already runs voice validation. Avoid nested duplicate
   checks and unrelated Room/Travel soaks. Executed failures block completion;
   unavailable capacity is not a test failure or a pass.
5. Inspect affected narrow/desktop layouts and interaction/fallback states.
   Report actual tests, unresolved limitations, preview location, and next action.

## Boundaries that remain real

- Never publish secrets, raw provider payloads, private evidence, local paths,
  ignored state, or cross-environment credentials/snapshots.
- Public connector reads, OAuth callbacks, saves, and maintenance never refresh
  collections. Studio owns manual refresh; failed attempts preserve accepted
  snapshots. Strava is separately configured and manually verified.
- Owner mutations require owner authorization, same-origin checks, bounded
  validated input, and sanitized no-store output. Preserve approval and
  publication gates without inventing new permissions.
- Keep rich runtimes and audio inside the scoped paths and intent/capability
  boundaries in `AGENTS.md`. No provider preload from Play. Disabled Simulation
  stays unreachable; unrelated copy work cannot activate it.
- Never rewrite applied migrations. Local, synthetic preview, staging, and
  production state stay isolated. No hosted mutation without the user's explicit
  authorization for that operation.

## Releases

Use coverage from the last deployed SHA through the candidate, including feature
modes. Unknown/shared-runtime/security/dependency changes select full applicable
coverage. Never use only the most recent CI repair.

`checks:artifact` reuses matching scan/render receipts. `release:resume` collects
the four exact-SHA identities and prepares local plans; it does not promote.
Preserve the signed-in owner checkpoint, explicit content-publication review,
0%-traffic candidate, guarded promotion, and rollback. Use the documented
native/disposable runner fallback when capacity is unavailable; never manufacture
evidence or repeat successful identical jobs unnecessarily.

Keep independent operations moving when one gate needs owner input. Distinguish
code complete, locally validated, hosted configuration saved, and production
verified. A capacity failure is a reason to use the documented fallback, not
to weaken checks or repeatedly dispatch the same unavailable runner. Diagnose
a failing feature with focused traces before rerunning the complete candidate.
Adding monitoring or using included paid-tier capacity does not authorize a
new subscription, broader repository access, or automatic production deploys.

For skill edits, run structural validation and review the realistic
[intent scenarios](tests/intent-scenarios.md). These checks complement behavior
tests; neither frontmatter validation nor an agent's claim proves compliance.
