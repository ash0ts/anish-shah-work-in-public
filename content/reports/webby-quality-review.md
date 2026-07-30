# Webby-quality release review

Review date: 2026-07-30
Content version: `50bac7d3babb391a`

## Content

- The opening viewport states Anish Shah’s name, applied-AI focus, point of view, and the primary “Explore my work” action.
- Eight selected works, three qualified impact moments, and the 2021–now trajectory lead into the complete 184-record archive.
- All public claims come from the 13 approved rounded projections. Qualifiers, periods, attribution, and public evidence remain attached.

## Structure and navigation

- The public hierarchy is Home, Work, Play, About, and Sources, with a separate owner-only Studio.
- Search, filter, skip-link, mobile menu, back-links, related records, and source-context links were checked with keyboard-sized controls and server-rendered fallbacks.
- Every public record has a unique stable slug and a case-study route.

## Visual design

- The “Work in Public” system uses oversized kinetic identity, an index ribbon made from real work, editorial posters, and typographic impact spreads.
- The palette and type system remain restrained and subject-aware. Dashboard cards, blueprint grids, fake terminals, film UI, and decorative analytics were removed.
- Recursive’s full expressive axes are isolated to a 12 KB uppercase subset for the hero; the reading and evidence faces are self-hosted Latin subsets.

## Functionality

- The sanitized bundle is the sole substantive public source. Published D1 overrides may only order, feature, hide, or replace allowlisted plain-text wording and caveats.
- Studio writes require Sign in with ChatGPT plus the exact-email owner allowlist. Connector secrets use authenticated encryption.
- MyAnimeList and Hardcover use cached, last-known-good snapshots with 12-hour refresh throttling and duplicate-refresh locks. Strava remains consent-gated.

## Interactivity

- Anime.js drives short, interruptible hero/index choreography with pause and reduced-motion behavior.
- The visual archive dynamically imports Three.js only after “Open visual archive”; the equivalent HTML archive remains available.
- Personal streams have loading, stale, failure, unpublished, and no-JavaScript states. No third-party Strava request occurs before consent.

## Innovation

- The identity-to-index transition uses the work itself as the visual material.
- Each claim remains inspectable without turning the portfolio into a ledger or dashboard.
- The expressive hero font responds through real variable-font axes while preserving an early stable paint.

## Overall experience and release gates

- Two production-local mobile Lighthouse audits: Performance 96–98, Accessibility 100, Best Practices 100, SEO 100; LCP 1.97–2.3 s, TBT 0 ms, CLS 0.
- Automated validation: 35 content/privacy/connector tests, 13 backend/security tests, and 5 rendered-output tests passed.
- Content accounting: 184/184 footprint rows and 85/85 impact rows accounted for; 184 public items, 13 public metrics, 196 public evidence records, and 60 stable relations.
- Production dependency audit: zero known runtime vulnerabilities with development dependencies omitted.
- URL audit: 192 of 194 external references resolved in the final check. The retired Ray Summit 2023 host and intermittently unavailable Prog.AI profile remain as historical provenance but are rendered as unavailable, not clickable; the Ray talk retains its working public recording.
- The deprecated film workspace, playback UI, rendering stack, and private owner content are absent from the public build.

Result: all explicit release gates pass.
