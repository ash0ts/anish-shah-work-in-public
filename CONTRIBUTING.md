# Contributing

This is a private, owner-operated portfolio. Keep changes focused, reviewable,
reversible, and tied to one user-visible or operational outcome.

## Choose the right path

### Engineering change

1. Branch from current `main` with a descriptive name.
2. Follow the exact local workflow in [Testing](./docs/testing.md).
3. Trace the authoritative source before editing; do not patch generated output.
4. Add a regression test for a repaired invariant.
5. Run the checks selected by the repository maintenance helper.
6. Open a PR with motivation, trust boundary, evidence, screenshots where
   relevant, migration impact, and rollback notes.

### Copy-only change

Edit only the declared fields in `content/copy/**/*.md` and use the copy PR
template. Follow [Copywriting](./docs/copywriting.md). A copy-only PR is
validated and previewed using trusted base-branch code; it cannot change
application behavior, facts outside the allowlist, metrics, evidence, policy,
routes, or deployment.

If a copywriter requests layout or behavior work, describe it in the PR’s
implementation-request section. The owner may add implementation commits,
which intentionally moves the PR into the normal engineering lane, or open a
linked engineering PR.

## Non-negotiable boundaries

- Never commit credentials, OAuth material, D1/KV exports, `.env.local`,
  `.wrangler`, private source inputs, or provider payloads.
- `content/public/anish-content.public.v1.json` is generated deployable data,
  not an editing surface.
- `content/copy/` changes presentation wording only; its parser rejects markup,
  links, scripts, private paths, and quantitative metric-shaped copy.
- D1 migrations are forward-only. Use expand/backfill/contract and never edit
  an applied migration.
- Keep local, preview, staging, production, and private Sites-reference state
  isolated.
- Do not change IDs, route aliases, Access verification, credential encryption,
  publication policy, or connector schemas as incidental refactoring.
- Remote migrations, deployment, Access changes, or secret rotation require
  explicit owner authorization and the applicable runbook.

## Review and merge policy

Before granting a freelancer write access, the owner must verify GitHub Pro
branch protection on `main`: pull requests required, one owner/CODEOWNER
approval, stale approvals dismissed, conversations resolved, required checks
green, and direct/force pushes and branch deletion disabled. Do not describe
those protections as active until they have been verified in GitHub.

All release evidence must belong to the exact pushed commit. Browser Quality
may skip documentation-only PRs, but staging and production releases always
require exact-SHA Validate, Gitleaks, CodeQL, and Browser Quality evidence.
Four GitHub workflow runs are the default and remain the isolated-staging
contract. The production release runbook documents its explicit owner-local
capacity fallback; it retains every check and the immutable-build contract
rather than waiving them. See
[Testing](./docs/testing.md) and the
[release runbook](./docs/operations/release.md).
