# My Room, 2001 — current architecture

This document is the implementation and operations authority for the shipped
room. Historical prototype RFCs are intentionally not retained in the active
documentation tree.

## Route contract

My Room is the authoritative Play experience:

| Route | Object | Source |
| --- | --- | --- |
| `/play` | semantic room overview | none |
| `/play/watch` | graphite television | MyAnimeList |
| `/play/read` | wooden bookshelf | Hardcover |
| `/play/listen` | pocket player | Spotify |
| `/play/collect` | record crate | Discogs |
| `/play/play` | beige computer | Steam |
| `/play/move` | treadmill television | Strava |
| `/play/travel` | tabletop globe | owner-published Travel atlas |

`/play` performs zero connector or Travel reads. Each object route dispatches
through a closed structural contract and a matching literal executable map.
It requests only its associated public connector projection or sanitized Travel
publication. Unknown slugs 404. Query variants are noindexed. Provider data,
artwork, Travel photos, and embeds stay in the DOM and never enter the room
Canvas.

## Semantic-first shell

`app/play/layout.tsx` installs the room state provider. `RoomOverview` renders
the poster, room entry control, and seven ordinary links server-side. Directly
loading an object route renders its useful collection screen without creating
the room. Browser Back and the explicit return control remain authoritative;
focus returns to the corresponding semantic object control.

The seven screen loaders, object definitions, content-source adapters, scene objects,
and focus targets use closed registries with identical keys. Route parameters,
D1 values, mesh metadata, or provider payloads cannot select executable
modules. Travel is removed from every public room surface when its feature gate
is disabled.

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

When the reviewed neutral room composition changes, capture that pose and run
`npm run room:poster -- <screenshot.png>`. The tool emits content-hashed AVIF
and WebP fallbacks under `public/assets/play` and enforces the 200 KB budget for
each format. Update the poster imports and remove superseded hashes in the same
reviewed change.

## Pocket Room

Eligible coarse-pointer viewports receive a separate portrait composition only
after `OPEN THE POCKET ROOM`. It reuses the room's first-party primitives but
uses a normal perspective camera, three authored stops, visible Previous/Next/
Reset controls, and a semantic safe-area dock. It never downloads the desktop
fisheye module. Save-Data, reduced motion, forced colors, high zoom, failed
WebGL, sustained frame misses, or context loss keep the complete poster and
directory instead.

Pocket taps use same-object pointer down/up with a larger movement threshold;
swipes, multiple pointers, cancellation, rotation, and lost capture cannot open
an object. The dock remains the authoritative accessible interface.

## Input and transitions

Mouse and pen may rotate or select. An eight-pixel threshold separates click
from drag, pointer down/up must resolve to the same hit target, and occluders win
nearest-hit resolution. Touch remains with the document and semantic controls.

Anime.js handles short acknowledgement, approach, match-cut, return, and screen
reveals. Transitions are cancellable; route state wins over animation state.
Reduced motion applies final state immediately. A visible rewind status covers
the asynchronous return while preserving the selected object.

## Data and privacy invariants

- No connector or Travel fetch occurs on the room overview.
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
[Staging releases](../operations/staging.md) for live provider
and Safari acceptance.
