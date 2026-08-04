# Copy Pull Request Workflow

## Before Editing

- Start from current `main` and change only approved copy-deck Markdown plus the copy PR template response.
- Do not add scripts, binaries, symlinks, workflow/config files, or generated output.
- State the audience, objective, changed pages/WorkGroups, factual claims touched, SEO intent, and any implementation request.

## Validation and Preview

Run when local tooling is available:

```bash
npm run copy:check
npm run copy:diff -- --base origin/main
npm run copy:test
```

A qualifying copy-only PR is rebuilt by trusted base-branch code and deployed with synthetic fixtures. It has no production data, D1, KV, OAuth, provider credentials, Studio, cron, or write APIs. The preview comment should show URL, exact SHA, `COPY_VERSION`, risk-grouped keys, affected routes, validation, and screenshots.

Review:

- Every changed route at narrow and desktop widths.
- Long title/paragraph wrapping and absence of horizontal overflow.
- Metadata/social copy and structured data.
- Visible labels in their keyboard and screen-reader context.
- Synthetic-data labels and the fact that the preview is Access-protected and unindexed.

## Review and Merge

- Editorial changes need the normal owner/CODEOWNER review.
- Fact-check changes need explicit owner verification of claims and context.
- New commits dismiss stale approval; resolve all conversations before merge.
- Do not merge when a requested implementation change is silently outstanding. The owner must implement it in reviewed commits, move it to a linked engineering PR/issue, or explicitly defer it.

If any code or non-copy file changes, the trusted copy-only lane stops. Normal engineering classification, checks, and owner-approved previewing apply.
