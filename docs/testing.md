# Testing and release gates

## Authoritative local gate

```bash
npm install --global npm@11.6.2 --ignore-scripts
npm ci
npm run db:local:migrate
npm run validate
```

`validate` covers public-content attestation, lint, typechecking, content and
privacy contracts, backend authorization, production build, release-bundle
scanning, rendered HTTP routes, and dependency advisories. GitHub Validate runs
the same command after applying all migrations to a clean local D1.

Run the manually dispatched Validate, Gitleaks, CodeQL, and Browser Quality
workflows with the same full 40-character commit SHA before release. The
checkout step rejects a different commit. Browser stability is a separate,
optional ten-run soak and is not release-plan evidence.

## Temporary owner runner

Automatic pull-request jobs and `main` push jobs always use GitHub-hosted
`ubuntu-latest` runners. Feature branches are validated by their pull request;
Validate does not also run for every `codex/**` branch push.

When hosted Actions capacity is temporarily unavailable, the repository owner
may manually dispatch the same exact workflows with `runner_label` set to
`anish-release`. Each workflow rejects a dispatch whose actor is not the
repository owner or whose `commit_sha` is not exactly 40 lowercase hexadecimal
characters. The workflow names, paths, read-only permissions, exact-SHA checks,
and release-evidence contract remain unchanged.

The runner is a temporary repository runner, not a release machine. Register a
clean runner with the custom label `anish-release`, using a dedicated OS account
and working directory. Do not put Cloudflare credentials, provider tokens,
local `.env` files, D1 state, browser profiles, SSH agents, signing keys, or
other durable secrets in its service environment or working directory. Keep it
online until all jobs in a dispatched workflow finish—Browser Quality and the
stability soak contain multiple jobs—then stop and remove its registration.
The workflows do not select a GitHub environment or reference repository or
environment secrets; actions receive only the workflow's short-lived,
read-only `GITHUB_TOKEN`.

Dispatch the four release-evidence workflows from their trusted definition on
`main`, checking out one already-pushed commit:

```bash
export VALIDATED_SHA='<full 40-character pushed commit SHA>'

gh workflow run ci.yml --ref main \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
gh workflow run gitleaks.yml --ref main \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
gh workflow run codeql.yml --ref main \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
gh workflow run browser-quality.yml --ref main \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
```

Run the optional stability soak only when its explicit ten-run evidence is
required:

```bash
gh workflow run browser-stability.yml --ref main \
  -f commit_sha="$VALIDATED_SHA" -f runner_label=anish-release
```

Use the resulting Actions run URLs normally. A self-hosted run does not waive
or replace any assertion, artifact, browser, security, or release-plan check.

## Browser quality

Install the pinned Chromium build once, then run the browser gate:

```bash
npx --no-install playwright install chromium
npm run validate:browser
```

The Playwright/Axe suite exercises real Worker pages and covers:

- 320, 390, 640, 768, 1024, 1440, and 1920px viewports
- `scrollWidth`, 200%/400% equivalent reflow widths, and text-spacing overrides
- keyboard operation, focus restoration, and consent flows
- reduced motion and forced colors
- Axe serious/critical findings on the five primary public routes

The browser command runs two isolated passes automatically: classic Play first,
then My Room 2001 under the exact synthetic-preview boundary. The room pass also
checks the six direct object routes, provider-free overview, deferred Three.js
loading, poster fallback, fixture propagation, and the reduced-motion,
Save-Data, and forced-color paths that must never request the 3D runtime. Do not
run the command a second time with a manual `PLAY_EXPERIENCE_MODE` override.

The same command runs Lighthouse directly against a second local Worker preview
and enforces mobile performance, accessibility, SEO, and best-practice scores of
at least 0.90 plus CLS no greater than 0.1. JSON reports stay in the ignored
`.lighthouse/` directory; CI does not upload them.

Remote PR previews contain deterministic synthetic connector fixtures and are
for visual/interaction review only. Use stable staging for real OAuth,
connector refresh, D1 migration, and Safari acceptance. A preview URL is never
evidence that provider integration or production data is healthy.

## Content changes

Full private-source regeneration cannot run on ordinary CI. The owner must run
`verify:content`, update the safe attestation, and include the public projection,
schema/report changes, and attestation in one PR. CI then proves those public
artifacts remain byte-identical to the attestation.
