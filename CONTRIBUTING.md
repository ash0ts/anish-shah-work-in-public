# Contributing

This is a private, owner-operated portfolio. Changes should be small,
reviewable, reversible, and tied to one user-visible or operational outcome.

## Workflow

1. Branch from current `main` using `codex/<short-purpose>` or another clearly
   named branch.
2. Use Node `24.18.0`, activate npm `11.6.2` with Corepack, and use
   `npm ci`.
3. Keep secrets in the permission-restricted `.env.local`; never place real
   credentials, tokens, D1 exports, OAuth codes, or private source material in
   commits, logs, screenshots, issues, or PRs.
4. Run `npm run validate` and apply migrations to a fresh local D1 with
   `npm run db:local:migrate`.
5. Open a PR and obtain owner review. Because this private repository cannot
   currently enforce branch protection, the owner must confirm Validate,
   Gitleaks, and CodeQL on the exact commit before merge or release.

## Boundaries

- `content/public/anish-content.public.v1.json` is the only deployable content
  bundle. Private source files and `content/private/` stay outside Git.
- A content change must run the private-source regeneration check followed by
  `npm run content:attest:write`; include both projection and attestation.
- D1 migrations are forward-only. Use expand/backfill/contract: first make an
  additive change compatible with both old and new Worker versions, backfill
  separately, and remove old fields only in a later release.
- Do not modify published IDs, route aliases, credential encryption, Access
  verification, or publication policy as incidental refactoring.
- Keep production and local OAuth applications, credentials, snapshots, and
  D1 databases isolated.

## Pull-request evidence

Include the motivation, affected trust boundary, tests run, screenshots for UI
changes, migration/rollback impact, content-attestation impact, and any manual
production step. Use the checked-in PR template.

Browser accessibility and performance changes require `npm run
validate:browser`. Install the pinned Chromium build first as described in
[testing](./docs/testing.md); attach relevant screenshots or traces to the PR.
