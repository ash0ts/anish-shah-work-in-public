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

Run the manually dispatched Validate, Gitleaks, and CodeQL workflows with the
same full 40-character commit SHA before release. The checkout step rejects a
different commit.

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

When changing the Play room, run the browser gate twice: once with the default
classic mode and once with `PLAY_EXPERIENCE_MODE=my-room-2001`. The room pass
also checks the six direct object routes, the provider-free overview, deferred
Three.js loading, poster fallback, and the reduced-motion/Save-Data/forced-color
paths that must never request the 3D runtime.

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
