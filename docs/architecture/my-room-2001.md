# My Room, 2001 — current architecture

This document describes the shipped implementation. The original
[interaction RFC](../play-experience-prototypes/my-room-2001-interactive-object-archive.md)
is historical design context, not an operations or implementation authority.

## Route contract

My Room is the authoritative Play experience:

| Route | Object | Provider |
| --- | --- | --- |
| `/play` | semantic room overview | none |
| `/play/watch` | graphite television | MyAnimeList |
| `/play/read` | wooden bookshelf | Hardcover |
| `/play/listen` | pocket player | Spotify |
| `/play/collect` | record crate | Discogs |
| `/play/play` | beige computer | Steam |
| `/play/move` | treadmill television | Strava |

`/play` performs zero connector reads. Each object route dispatches through a
closed literal registry and requests only its associated public connector
projection. Unknown slugs 404. Query variants are noindexed. Provider data,
artwork, and embeds stay in the DOM and never enter the Canvas.

## Semantic-first shell

`app/play/layout.tsx` installs the room state provider. `RoomOverview` renders
the poster, Enter Room control, and six ordinary links server-side. Directly
loading an object route renders its useful collection screen without creating
the room. Browser Back and the explicit return control remain authoritative;
focus returns to the corresponding semantic object control.

The six screen loaders, object definitions, provider adapters, and focus targets
use closed registries with identical keys. Route parameters, D1 values, mesh
metadata, or provider payloads cannot select executable modules.

## Optional Three.js runtime

All Three/R3F imports live under `components/play/room-3d/**` and are reached
through lazy client boundaries only after the visitor selects Enter Room. The
Canvas is `aria-hidden`, outside keyboard order, and never replaces the semantic
directory.

The capability gate requires all of the following:

- viewport at least 1100 CSS pixels;
- fine primary pointer;
- no reduced-motion or forced-colors preference;
- Save-Data disabled;
- document visible and below the zoom fallback threshold; and
- a successful WebGL2 probe.

An ineligible device never requests the 3D chunk and keeps the poster plus
directory. Context loss or runtime failure permanently falls back for the
session. The reviewed high tier uses Drei Fisheye; frame-health checks downgrade
to wide perspective when the fisheye path misses its budget.

The scene is original procedural geometry with shared toon materials and
instanced repeated objects. It uses one Canvas, bounded rotation, explicit view
controls, no physics, no orbit controls, no zoom/pan/inertia, and no autoplay or
scroll capture. The room has no idle animation requirement.

## Input and transitions

Mouse and pen may rotate or select. An eight-pixel threshold separates click
from drag, pointer down/up must resolve to the same hit target, and occluders win
nearest-hit resolution. Touch remains with the document and semantic controls.

Anime.js handles short acknowledgement, approach, match-cut, return, and screen
reveals. Transitions are cancellable; route state wins over animation state.
Reduced motion applies final state immediately. A visible rewind status covers
the asynchronous return while preserving the selected object.

## Data and privacy invariants

- No connector fetch occurs on the room overview.
- No inactive provider, artwork, iframe, or screen chunk is preloaded.
- Spotify and Strava third-party frames remain consent-gated.
- Preview fixtures are accepted only in the exact preview tier.
- `/play/**` is dynamic and private/no-store; hosted tier/origin checks still apply.
- Room interaction and provider content are not written to request logs.

## Validation

Browser Quality verifies server foundations, direct-route connector isolation,
zero Three/R3F bytes before entry, capability fallbacks, click-versus-drag,
focus restoration, context loss, reduced motion, forced colors, Save-Data,
reflow, screenshots, and Lighthouse budgets. The shared readiness helper waits
for semantic room state with a 15-second SLO and captures diagnostics on failure.

Use [Testing](../testing.md) for local commands and
[Staging and previews](../operations/staging-and-previews.md) for live provider
and Safari acceptance.
