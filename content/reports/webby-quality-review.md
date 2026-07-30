# Webby-quality release review

Review date: 2026-07-30

Release candidate: Bodies of Work v1.3

Content version: `53cf9612400b16cc`

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
- The homepage uses representative stories and a four-part Impact Ledger rather
  than repeating the complete archive.
- WorkGroup pages keep occurrences, recordings, translations, repositories,
  pull requests, and references attached to the story they support.
- Sources separates archive accounting from the impact ledger and states what
  the site does not claim, including that supported pipeline is not revenue,
  ARR, or sole-person causality.
- Representative titles, child associations, claim-to-work links, and the
  complete generated bundle passed the final editorial and migration checks.

## Structure and navigation — 8.4 / 10

- The primary navigation stays compact: Work, About, and Play, with Sources and
  Privacy in the footer.
- Work opens with a semantic Story × Time index, then one paginated WorkGroup
  archive. Search includes nested titles and aliases while returning the parent
  story.
- Bucket, topic, year, and format controls expose the useful dimensions without
  asking visitors to learn an internal taxonomy.
- Group pages give public forms a clear home instead of presenting a second
  competing archive.
- Legacy redirects, context-only references, pagination, child-title search,
  and long-query filter states passed rendered-route verification.

## Visual design — 8.2 / 10

- The expressive choice is typographic organization, not a decorative
  dashboard: four ruled work rows, the Story × Time table, and the Impact
  Ledger all encode real structure.
- Recursive, Hanken Grotesk, and IBM Plex Mono retain distinct display,
  reading, and evidence roles. Trace white, blueprint ink, and work blue keep
  the palette controlled.
- Removing the 3D navigator makes the hierarchy more legible and avoids
  occlusion, tiny hit targets, and a second navigation model.
- The design now depends on precision in spacing, wrapping, and responsive
  hierarchy. Visual checks at 320, 390, 768, 1024, 1440, and 1920px found no
  viewport crossings, and the social image was replaced with the finished
  typographic direction.

## Functionality — 8.3 / 10

- Home, Work, WorkGroup detail, About, Sources, Privacy, and the Play fallbacks
  are server-readable without JavaScript.
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
- The Story × Time index remains selectable, searchable, and understandable
  without a canvas or motion.
- Play fetches only the active personal stream and gives unpublished or stale
  data a compact, directed state.
- The direction is coherent but deliberately less spectacular than the former
  WebGL concept. Native disclosure behavior, transition cancellation,
  reduced-motion final states, keyboard flow, and connector retry behavior are
  all covered by the release checks.

## Innovation — 7.9 / 10

- The strongest original idea is editorial rather than technical: one body of
  work can have many public forms without multiplying the apparent number of
  accomplishments.
- Story × Time turns a complicated public footprint into an inspectable career
  map using ordinary web structure, keeping the technology invisible.
- The Impact Ledger combines reach, participation, supported pipeline, and
  product usage without pretending they are directly comparable units.
- The model is differentiated by its content logic more than by a novel
  interaction. Its quality depends on the deduplication and relationships
  remaining credible under close inspection.

## Overall experience — 8.2 / 10

- The v1.3 direction is substantially clearer: one thesis, four bodies of work,
  one archive model, one impact ledger, and a small footer.
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
2. Automated checks: typecheck, lint, 84 content tests, 17 backend tests, 20
   rendered acceptance tests, production build, dependency audit, and privacy
   scans.
3. Responsive audit: Home, Work, a long WorkGroup detail, Sources, Play, About,
   and Privacy at 320, 390, 768, 1024, 1440, and 1920px, with no viewport
   crossings.
4. Interaction audit: keyboard order, visible focus, native disclosures,
   cancellable Anime.js enhancement, reduced motion, active-stream loading, and
   the Strava consent boundary.
5. Mobile Lighthouse against the production Worker build: Performance 95,
   Accessibility 100, Best Practices 100, SEO 100, and CLS 0.
6. Final social preview: 1200 × 630 typographic asset inspected against the
   release palette and information hierarchy.

Release status: **validated for private deployment**.
