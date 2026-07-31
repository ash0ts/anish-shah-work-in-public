# Webby-quality release review

Review date: 2026-07-31

Release candidate: Bodies of Work v1.3

Content version: `f599c1af4ac9c3df`

This is an internal review against the seven Webby website criteria, not an
award result. The exact release candidate described here completed the
verification record below.

## Verified content baseline

- 184 public-footprint source observations are preserved. They are source
  records, not a claim of 184 unique works.
- 85 impact observations remain in the migration account.
- The public archive currently resolves to 82 WorkGroups and 186 nested public
  forms.
- The public narrative uses 13 rounded measures in four impact families and
  links to 198 evidence records.
- Exact owner-only values, private notes, internal references, connector
  credentials, and unsupported attribution do not belong in public output.

## Content — 8.6 / 10

- Four Bodies of Work—Products and Open Source, Courses and Learning, Writing
  and Research, and Talks and Programs—give visitors a useful first reading of
  the career without flattening every appearance into another achievement.
- The homepage uses representative stories and three evidence tracks rather
  than repeating the complete archive. Product adoption leads with use,
  breadth, and return behavior; learning connects reach to observed action;
  program impact stays explicitly bounded.
- WorkGroup pages keep occurrences, recordings, translations, repositories,
  pull requests, and references attached to the story they support.
- Sources separates archive accounting from the impact ledger and states what
  the site does not claim, including that supported pipeline is not revenue,
  ARR, or sole-person causality.
- Representative titles, child associations, claim-to-work links, and the
  complete generated bundle passed the final editorial and migration checks.

## Structure and navigation — 8.4 / 10

- The primary navigation stays compact: Work and Play, with Sources and Privacy
  in the footer. Biography, current focus, and the 2021–Now arc now live in the
  homepage introduction; legacy About links redirect there.
- Work opens as four server-rendered body folds. Together they contain all 82
  WorkGroups exactly once, so the complete archive is present without
  pagination. A semantic four-line calendar heatmap summarizes 2021–2026 above
  them; each populated cell reports exact WorkGroup and public-form counts.
  Search includes nested titles and aliases while returning the parent story.
- Bucket, topic, year, and format controls expose the useful dimensions without
  asking visitors to learn an internal taxonomy.
- Calendar cells are ordinary links that filter the same four body folds by
  line and year, keeping one archive and one interaction model.
- Group pages give public forms a clear home instead of presenting a second
  competing archive.
- Legacy redirects, context-only references, body filtering, child-title
  search, and long-query filter states passed rendered-route verification.

## Visual design — 8.2 / 10

- The expressive choice is typographic organization, not a decorative
  dashboard: a four-stop career rule, four archive body folds, and three
  unboxed impact small multiples all encode real structure.
- Recursive, Hanken Grotesk, and IBM Plex Mono retain distinct display,
  reading, and evidence roles. Trace white, blueprint ink, and work blue keep
  the palette controlled.
- The 2021–2026 calendar uses color to identify each line of work and five
  shade levels to show relative density. Exact work and public-form counts stay
  visible, so color never has to carry meaning alone.
- Removing the 3D navigator makes the hierarchy more legible and avoids
  occlusion, tiny hit targets, and an opaque navigation model.
- The design now depends on precision in spacing, wrapping, and responsive
  hierarchy. Visual checks at 320, 390, 768, 1024, 1440, and 1920px found no
  viewport crossings, and the social image was replaced with the finished
  typographic direction.

## Functionality — 8.3 / 10

- Home, Work, WorkGroup detail, Sources, Privacy, and the Play fallbacks are
  server-readable without JavaScript. The retired About route permanently
  redirects to the homepage profile.
- The canonical public projection, D1 editorial boundary, exact-email owner
  authorization, encrypted provider credentials, sync history, and audit trail
  remain part of the implementation.
- MyAnimeList, Hardcover, Steam, and Strava have bounded public contracts;
  Strava loads only after consent and Steam requires a truthful storage-country
  configuration.
- The public runtime does not depend on 3D navigation, a cinematic renderer,
  or a video player.
- Connector expiry, replacement, provider outage, stale snapshots, bounded
  credential storage, and Steam tombstoning are covered by backend and fixture
  tests. Play’s active-stream loading and Strava consent gate were also checked
  in-browser.

## Interactivity — 7.8 / 10

- Interactions are intentionally restrained: native disclosures and links work
  first, while Anime.js supports short row, name, and route transitions.
- The complete calendar, all four body folds, and every WorkGroup link arrive
  in server HTML. Selecting a populated year cell applies its line and year as
  normal GET filters, then moves directly to the filtered folds.
- Row headers filter by line, exact counts label every populated cell, and the
  wide calendar remains a bounded horizontal scroll region on small screens.
- Play fetches only the active personal stream and gives unpublished or stale
  data a compact, directed state.
- The direction is coherent but deliberately less spectacular than the former
  WebGL concept. Native disclosure behavior, calendar filtering, transition
  cancellation, reduced-motion final states, keyboard flow, and connector
  retry behavior are all covered by the release checks.

## Innovation — 7.9 / 10

- The strongest original idea is editorial rather than technical: one body of
  work can have many public forms without multiplying the apparent number of
  accomplishments.
- Four complete body folds turn a complicated public footprint into an
  inspectable archive using ordinary web structure. The color-and-density
  calendar adds a compact chronological lens without becoming another taxonomy
  or navigation requirement.
- The impact small multiples rank repeat product use, learning-associated
  action, and supported pipeline without pretending they are directly
  comparable units.
- The model is differentiated by its content logic more than by a novel
  interaction. Its quality depends on the deduplication and relationships
  remaining credible under close inspection.

## Overall experience — 8.2 / 10

- The v1.3 direction is substantially clearer: one thesis and profile, four
  bodies of work, one complete archive with a six-year calendar, three impact
  stories, and a small footer.
- Visitors can scan the narrative before deciding whether to inspect all 82
  WorkGroups, their 186 public forms, or the evidence behind a claim.
- The absence of 3D and cinematic navigation is a product decision, not a
  fallback: legibility and trust are the signature.
- The release candidate meets the project’s production-quality gates while
  preserving the existing owner-only access policy.

## Verification record

1. Deterministic migration check: 184 footprint rows, 85 impact rows, 186
   public forms, 82 WorkGroups, 13 rounded public measures, 198 evidence
   records, and 64 typed relations.
2. Automated checks: typecheck, lint, 137 content tests, 27 backend tests, 20
   rendered acceptance tests, production build, dependency audit, and privacy
   scans.
3. Work archive audit: all 82 WorkGroups appear exactly once across four
   server-rendered body folds; the four-line 2021–2026 calendar exposes exact
   work/form counts and filters those folds through standard links.
4. Responsive audit: Home, Work, a long WorkGroup detail, Sources, Play, and
   Privacy at 320, 390, 768, 1024, 1440, and 1920px, with no viewport
   crossings; `/about` redirects to the homepage profile.
5. Interaction audit: keyboard order, visible focus, native disclosures,
   calendar filters, cancellable Anime.js enhancement, reduced motion,
   active-stream loading, and the Strava consent boundary.
6. Mobile Lighthouse against the production Worker build: Performance 95,
   Accessibility 100, Best Practices 100, SEO 100, and CLS 0.
7. Final social preview: 1200 × 630 typographic asset inspected against the
   release palette and information hierarchy.

Release status: **validated for private deployment**.
