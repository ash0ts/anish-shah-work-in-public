# Webby-quality release review

Review date: 2026-07-30

Release: Career Chapters v1.2

Content version: `66ef8ac8ee193cb3`

Scores below are an internal readiness review against the seven Webby website
criteria, not an award result.

## Content — 9.3 / 10

- Home is 178 visible content words before the shell. It contains one thesis,
  one primary CTA, five Career Chapters, twelve anchor links, and three
  qualified impact claims.
- The archive preserves 184 footprint rows and 85 impact rows. Public output
  remains limited to 13 approved, rounded metrics with attribution, period, and
  qualifier attached.
- Work pages show the title and summary once. Direct outcomes and wider program
  context are explicitly separated.
- Sources owns the methodology, all 13 claims in four themes, and 198 public
  evidence records.

## Navigation and structure — 9.4 / 10

- The public header is only Anish Shah, Work, About, and Play. Sources and
  Privacy live in the compact footer.
- Work is one server-rendered index of 99 canonical Works, 24 per page. Child
  titles, slugs, and aliases resolve to their parent Work and exact item anchor.
- Search, Topic, Year, and Format are direct controls. Organization and Role
  remain available under More filters without overloading the first viewport.
- Legacy map links redirect to the two-dimensional Work index while preserving
  valid search parameters.

## Visual design — 9.2 / 10

- One expressive device carries the site: a readable five-part career narrative
  progressively enhanced by a restrained chapter stack.
- Recursive, Hanken Grotesk, and IBM Plex Mono have distinct display, reading,
  and evidence roles. Trace white, blueprint ink, and work blue dominate; the
  three secondary accents appear only in the chapter leaves.
- Global CSS is 275 lines; route and component systems are scoped. The former
  4,813-line two-generation stylesheet, generic card walls, map, ticker, and
  oversized footer are gone.
- The 1200×630 social card is a 192 KiB typographic chapter-stack composition
  derived from the finished visual system.

## Functionality — 9.5 / 10

- Canonical content, D1 editorial boundaries, connector encryption, owner
  authorization, audit records, and Steam release gates remain intact.
- Sources defaults to twelve evidence rows and a server GET search. The default
  HTML response is about 46 KiB; the complete 198-row bibliography is rendered
  only after explicit selection.
- MyAnimeList, Hardcover, Steam, and Strava retain loading, stale, unavailable,
  and privacy-safe states. Strava creates no iframe before consent.
- Robots and sitemap surfaces include public editorial routes and canonical Work
  pages while excluding Studio and APIs.

## Interactivity — 9.1 / 10

- Anime.js transitions are short, interruptible, and resolve immediately under
  reduced motion.
- Three.js is a single deferred Home enhancement. It loads only at widths of at
  least 960px after readable paint and capability checks. Work contains no
  Three.js or map code.
- Chapter controls support keyboard Left, Right, Home, and End. Native details,
  direct Work links, and synchronized HTML panels remain the primary interface.
- Play uses four compact tabs with keyboard movement and four no-JavaScript
  disclosures. Unpublished streams occupy one row.

## Innovation — 8.9 / 10

- Career history becomes the interaction model without turning the portfolio
  into a visualization puzzle. Time and selected work are understandable before
  the canvas exists.
- The Three scene has no orbit controls, drag, zoom, autoplay, canvas labels, or
  permanent render loop. Technology is used as depth, not navigation.
- Canonical relations let one underlying work retain its recordings,
  translations, appearances, repositories, and evidence without multiplying
  accomplishments.

## Overall experience — 9.3 / 10

- Responsive audits at 320, 390, 768, 1024, 1440, and 1920px reported
  `scrollWidth === innerWidth` and no crossing elements for Home, Work,
  expanded Work filters, the longest Work title, About, Play, Sources, and
  Privacy.
- At a 900px audit viewport, Home is 1.5 desktop viewports and about 2.1 mobile
  viewports tall. The footer is 80px on desktop and 78px on mobile.
- Mobile, reduced-motion, and Save-Data branches do not request Three.js.
  Capable desktop widths render one canvas.
- Mobile Lighthouse: Performance 91, Accessibility 100, Best Practices 100,
  SEO 100; LCP 2.9s, TBT 0ms, CLS 0, initial transfer 278 KiB.
- Automated validation passes 70 content/privacy/connector tests, 14
  backend/security tests, 8 rendered-output tests, and 12 focused design
  acceptance tests.

Result: all v1.2 release gates pass. The remaining editorial risk is policy
approval for employer-related impact wording, not a technical or UX defect.
