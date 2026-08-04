# My Room, 2001 — Interactive Object Archive

> **Historical design context.** This RFC records the exploration that led to
> the shipped room. It is not the current implementation or operations
> authority. Use [the current My Room architecture](../architecture/my-room-2001.md),
> [testing](../testing.md), and [the release runbook](../operations/release.md)
> for maintenance decisions.

- Status: replacement implementation RFC
- Surface: `/play` and object-specific Play routes
- Experience: draggable fisheye low-poly room with unique object interfaces
- Canonical content: semantic HTML rendered by object-specific screen modules
- Spatial layer: one explicitly activated React Three Fiber room with a bounded
  presentation drag and intentional perspective fallback
- Interaction: direct object selection plus equivalent semantic controls
- Motion: Anime.js 4.5 for bounded camera, object, and DOM match cuts
- Assets: original or explicitly licensed, validated, content-hashed glTF/GLB
  object packs

## 1. Executive correction

The previous combined proposal, `archive-receiver-1999-2002.md`, is rejected as
the implementation direction for this concept.

Its central mistake was treating the bedroom as atmosphere around a shared
receiver/dashboard. That made the room decorative and forced every collection
back through one generic content aperture. It combined the documents at the
architecture level without combining their actual experiences.

My Room, 2001 makes the bedroom itself the interaction model.

Every authored interactive object in the room is:

- A recognizable spatial affordance.
- Directly selectable.
- Keyboard-reachable through an equivalent semantic object directory.
- Associated with one deterministic camera approach.
- Associated with one physical reaction.
- Associated with one unique Media Rack-grade interface.
- Deep-linkable.
- Independently code-split.
- Independently extensible.

The television does not open a generic panel labeled Watch. It becomes the
Midnight Broadcast interface. The bookshelf does not open the same panel with
amber accents. It opens into an actual semantic shelf. The pocket player fills
the stage and becomes the Ranked Groove. The record crate opens into dividers
and sleeves. The computer becomes a late-1990s desktop. The treadmill television
becomes the consent-gated Move screen.

The room is the world. Each selected object becomes its own interface.

## 2. Concept statement

My Room, 2001 is a point-and-click personal media archive inspired by the
interaction rhythm of late-1990s and early-2000s adventure-game rooms:

```text
Enter the room
  → notice an object
    → focus or point at it
      → select it
        → approach it
          → object physically responds
            → match-cut into its unique interface
              → explore the real collection
                → return to the room
```

The experience should feel discovered, physical, and personal while remaining
fast enough for a visitor who simply wants to see the collection.

It is game-like because objects respond, space matters, transitions have
physical logic, the browser Back action behaves like leaving an object, and the
room remembers where the visitor was. It is not a game because there are no
puzzles, failure states, scores, hidden requirements, quests, or navigation
skills needed to reach content.

## 3. The core promise

Every object that looks interactive must do something meaningful.

Every interaction must lead to a distinct experience.

Every distinct experience must remain a normal, accessible web interface.

Every new room object must be addable through a documented, typed, reviewable
extension contract rather than a redesign of the whole room.

## 4. Relationship to the two source RFCs

This RFC fuses the source documents through an object interaction loop.

### 4.1 From Bedroom Archive, 1999

- One authored, isometric-like three-quarter bedroom diorama.
- Recognizable physical stations.
- One neutral overview, a tightly bounded optional room drag, and authored
  approach cameras.
- An original, provenance-tracked room asset pipeline.
- A bounded spatial experience instead of free navigation.
- A deliberate static/mobile fallback.

### 4.2 From Media Rack, 2002

- Six materially distinct interfaces.
- Device-specific data presentation.
- Object-specific motion grammar.
- Semantic HTML for collections, status, links, search, and consent.
- Active-provider-only loading.
- CSS/SVG hardware and physical-detail language.

### 4.3 The actual fusion

Each Bedroom Archive object is the physical origin of exactly one Media Rack
interface:

| Bedroom object | Selection verb | Unique interface |
| --- | --- | --- |
| Graphite television | Tune in | Midnight Broadcast / MyAnimeList |
| Bookshelf | Pull a book | Borrowed Shelf / Hardcover |
| Pocket player in dock | Wake player | Ranked Groove / Spotify |
| Record crate | Flip a sleeve | Crate Archive / Discogs |
| Beige computer | Power on | Desktop Library / Steam |
| Treadmill television | Start screen | Cardio TV / Strava |

The transition between object and interface is not incidental decoration. It is
the bridge that makes the two source ideas one experience.

## 5. Product intent

The Play page should feel like entering Anish's media memory rather than opening
a set of API integrations.

The room communicates identity through arrangement:

- What sits near the bed.
- What lives on a shelf.
- What is docked and charged.
- What is collected physically.
- What is played at a desk.
- What accompanies movement.

The interfaces communicate real data through the physical language of those
objects.

The target reaction is not `this page has six connectors.` It is:

> I understand how this person's media life fits together, and every object is
> fun to open.

## 6. Success criteria

The prototype succeeds only when:

- Visitors understand that room objects are selectable without written
  instructions.
- Every registered object has an obvious label on hover, focus, or touch.
- The pointer-selected object and semantic selected object always agree.
- Selecting any object acknowledges input within one animation frame.
- Each object opens a materially distinct interface, not a recolored shared card.
- The real provider content is readable within the unique interface.
- Returning to the room restores the previous object and focus.
- Browser Back behaves like `Back to room`.
- Direct object URLs render useful content without first entering the room.
- Only the selected object screen, provider, artwork, and optional detail asset
  are requested.
- New objects can be added without changing the room engine or other screens.
- No provider payload enters WebGL.
- No required information exists only in the canvas.
- Mobile, no-JavaScript, reduced-motion, forced-colors, Save-Data, zoom, failed
  WebGL, failed assets, and context loss remain designed experiences.
- The room remains performant and stops rendering at rest.
- The original art avoids copied trade dress.

## 7. Non-goals

My Room, 2001 is not:

- A central receiver UI.
- A dashboard below a room illustration.
- Six cards arranged inside WebGL.
- A first-person game.
- A free-roaming 3D environment.
- A collection-item visualization in 3D.
- A puzzle or scavenger hunt.
- A replica of a real bedroom.
- A replica of Toonami, Apple, Windows, Steam, Strava, Spotify, or another brand.
- A reason to change connector APIs or public payloads.
- A reason to preload every provider.
- A reason to relax CSP.
- A reason to add autoplay, ambient sound, or audio-reactive graphics.
- A reason to add Three.js to Home, Work, Sources, Studio, or the Worker.

Do not add:

- WASD.
- Orbit controls.
- Mouse-look.
- Pointer lock.
- Free or unbounded drag-to-look.
- User camera zoom.
- Pan, wheel capture, pinch zoom, roll, or camera dolly controls.
- Drag inertia or camera flinging.
- Physics.
- Collision-based navigation.
- Hidden required hotspots.
- Locked content.
- Scores, achievements, or completion percentages.
- Unskippable transitions.
- Continuous camera sway.
- Scroll-driven camera motion.
- Full-screen post-processing.
- Provider artwork as WebGL textures.
- Provider interfaces through CSS3DRenderer.

## 8. Avoiding the dashboard mistake

The implementation must prohibit the visual structures that made the rejected
hybrid generic:

- No permanent six-tab dashboard under the room.
- No shared white panel reused for all providers.
- No global inspector that changes only title and accent.
- No permanent metric sidebar.
- No provider cards floating around the room.
- No room overview filled with counts.
- No conventional gallery repeated beneath every object.
- No receiver strip as the dominant metaphor.

Shared code may own:

- Route/state transitions.
- Focus restoration.
- Loading and safe error boundaries.
- Connector status vocabulary.
- Provider attribution primitives.
- Gallery pagination primitives.
- Consent primitives.

Shared code must not force:

- One chassis.
- One viewport ratio.
- One card layout.
- One navigation position.
- One transition.
- One metric treatment.
- One collection visualization.

Each object screen owns its composition.

## 9. Experience map

The final route model is:

```text
/play             room overview
/play/watch       television / MyAnimeList
/play/read        bookshelf / Hardcover
/play/listen      pocket player / Spotify
/play/collect     record crate / Discogs
/play/play        beige computer / Steam
/play/move        treadmill television / Strava
```

Future objects add routes under `/play/<object-slug>`.

The object routes are real pages, not modal-only client states.

Benefits:

- Browser Back returns to the room naturally.
- Refresh preserves the selected object.
- Direct links bypass room loading.
- No-JavaScript requests receive a meaningful object page.
- Every screen gets an independent client entry.
- New objects do not enlarge every existing screen.
- Object-specific metadata can be curated.

Unknown or hidden slugs return the normal noindexed 404. Slugs are source-owned,
stable, and never derived from provider data.

## 10. Persistent room layout and routing

Use a persistent `/play` layout so the room can animate into an object route
without being destroyed before the transition completes.

```text
app/play/layout.tsx
└── PlayRoomLayout
    └── RoomExperienceProvider
        ├── RoomStage
        └── route content slot

app/play/page.tsx
└── RoomOverviewPage

app/play/[objectSlug]/page.tsx
└── RoomObjectPage
    └── ActiveRoomObjectScreen
```

Selection sequence:

1. Dispatch `OPEN_OBJECT` immediately.
2. Begin object and camera approach.
3. Begin the literal object-screen chunk request.
4. Begin the selected provider request only when its screen mounts.
5. Navigate to the validated object route with scroll preservation.
6. Match-cut from the final room frame into the route's unique interface.

Direct route sequence:

1. Validate slug on the server.
2. Render the semantic object screen foundation immediately.
3. Do not load the room unless the visitor chooses `Back to room` or `Enter room`.
4. Preserve the same provider publication and consent behavior.

Do not make screen availability depend on successful room rendering.

## 11. Canonical interaction loop

### 11.1 Overview

- Authored neutral room pose with an optional, tightly bounded presentation
  drag on eligible desktop devices.
- Interactive objects read clearly by silhouette.
- Hover/focus label appears beside the object.
- A compact `Objects` directory remains available.
- Decorative props do not pretend to be interactive.
- Every object remains visible and usable at the neutral pose; rotating the
  room is never necessary to discover or open content.

### 11.2 Intent

- Hover or focus produces a small physical response.
- Pointer cursor and label acknowledge affordance.
- Touch first activation reveals the label; a deliberate tap commits if the
  platform's pointer behavior makes accidental activation likely.
- Keyboard Enter/Space commits the focused object.

### 11.3 Approach

- The selected object reacts.
- Camera travels through an authored, bounded path.
- The screen chunk and provider request proceed independently.
- Escape skips to the object screen or returns, according to phase.

### 11.4 Match cut

- A physical surface fills the view.
- A CSS/SVG counterpart replaces that surface.
- The semantic screen becomes readable.
- Focus moves to its visible heading or `Back to room` control.

### 11.5 Explore

- The object interface uses real provider data.
- Search, filters, galleries, status, attribution, and consent remain HTML.
- The room suspends and consumes no idle GPU work behind the screen.

### 11.6 Return

- Back, Escape, browser Back, or `Back to room` starts exit.
- The object screen resolves to its transition surface.
- Room restores the focused object state.
- Camera returns to overview.
- Focus returns to the invoking object control.

## 12. Room modes

```ts
type RoomMode =
  | "poster"
  | "loading-room"
  | "overview"
  | "approaching"
  | "opening-object"
  | "object-screen"
  | "closing-object"
  | "returning"
  | "failed";
```

Only one mode is active.

Provider state is separate. A provider failure cannot move the room back to
overview or mark the room failed.

## 13. Input model

### 13.1 Pointer interaction

Capable desktop users can select the actual modeled object.

- Raycast only against simplified invisible hit proxies.
- Do not raycast detailed visible meshes.
- Put hit proxies on a dedicated interaction layer.
- Raycast only on pointer events, never continuously.
- Throttle pointer-move hit tests to one pending animation frame.
- Commit on `pointerup` only when down/up resolve to the same object.
- Reject activation after movement exceeds a small CSS-pixel threshold.
- Clear hover on pointer leave/cancel.
- Touch has no hover-only information.
- Fine-pointer desktop users may rotate the room group inside the reviewed
  azimuth and polar envelope. The gesture never pans, zooms, rolls, changes
  camera distance, or becomes a prerequisite for selection.
- Coarse-pointer and touch drags remain browser scrolling gestures. A touch tap
  may select an object, but touch never rotates the room.

The room uses a closed runtime map:

```ts
type InteractionMap = Map<string, RoomObjectId>; // Object3D UUID → safe ID
```

Do not trust arbitrary GLB `userData` to select a screen or route.

### 13.1.1 Click-versus-drag arbitration

Room rotation and object activation share one pointer-intent state machine.
They must not be implemented as unrelated canvas listeners.

1. Accept only the primary pointer and primary button.
2. On `pointerdown`, record the pointer ID, origin, nearest unoccluded object,
   and overview pose. Do not navigate yet.
3. Treat a radial movement of 8 CSS pixels or less as selection jitter.
4. Crossing 8 CSS pixels permanently promotes the gesture to `dragging`,
   clears the candidate object and hover state, and begins bounded rotation.
5. On `pointerup` while still pending, raycast again and open only when down and
   up resolve to the same registered object.
6. On `pointerup` after a drag, retain the bounded pose and never open an object,
   even if the pointer returns to its origin.
7. Do not attach an independent `click` handler; this prevents a synthetic click
   after drag.
8. Pointer cancellation, lost capture, a second pointer, route change, resize,
   visibility loss, or context loss cancels the gesture. An aborted drag restores
   its pre-drag pose.
9. Suspend hover during drag and recalculate it on the next ordinary pointer
   move.
10. Object approach locks room rotation. Returning restores the visitor's saved
    overview pose.

Fisheye mode must use the projection-aware pointer computation supplied by the
reviewed Drei implementation. Ordinary normalized-device-coordinate raycasting
against the undistorted camera is not valid at the warped edges. The semantic
directory remains the authoritative non-spatial selector.

### 13.2 Semantic object directory

The room always has an equivalent semantic control system.

```html
<nav aria-label="Objects in Anish's media room">
  <a href="/play/watch">Television · Watch</a>
  <a href="/play/read">Bookshelf · Read</a>
  <a href="/play/listen">Pocket player · Listen</a>
  <a href="/play/collect">Record crate · Collect</a>
  <a href="/play/play">Computer · Play</a>
  <a href="/play/move">Treadmill TV · Move</a>
</nav>
```

The directory is compact and visually secondary but never hidden behind a
canvas-only action.

Scene and directory selection dispatch the same typed event and must produce
identical route, screen, provider request, room target, and announcement.

### 13.3 Keyboard interaction

- Tab reaches the object directory.
- Arrow keys may move spatially among objects when the directory acts as one
  composite widget.
- Home/End moves to first/last object.
- Enter/Space opens.
- Escape leaves an object screen or cancels a transition.
- Focus is always visible.

The canvas remains `aria-hidden` and outside the tab order. If bounded room
rotation ships, provide a separate native-button group labeled `Visual room
angle` with `Turn left`, `Turn right`, `Tilt up`, `Tilt down`, and `Reset view`.
Each directional action changes the optional pose by 4 degrees and disables at
its bound. These controls provide an equivalent visual adjustment for sighted
keyboard users; the object directory remains the efficient content navigation.
- Selection and focus are distinct.

Do not invent keyboard behavior for the canvas itself. The canvas remains
outside the tab order.

### 13.4 Spatial keyboard graph

Define explicit neighbors instead of calculating them from current pixels:

```ts
type SpatialNeighbors = {
  up?: RoomObjectId;
  right?: RoomObjectId;
  down?: RoomObjectId;
  left?: RoomObjectId;
};
```

The manifest stores one tested neighbor map per room zone. This prevents layout
or camera changes from silently changing keyboard navigation.

## 14. Game-feel contract

Game feel comes from responsiveness and physical staging, not controls that make
the site harder to use.

Required:

- Input acknowledgment within one rendered frame.
- Hover and keyboard focus produce the same object response.
- One small mechanical response per object.
- One shared easing family across room movement.
- One unique match-cut per object.
- Skippable and cancellable transitions.
- Escape always works.
- Browser Back always works.
- Room remembers last focused object.
- Object screens preserve session UI state when practical.
- Returning to an object does not replay a long intro.

Prohibited:

- Idle camera sway.
- Attraction-mode tour.
- Ambient looping object animations.
- Random particles.
- Pointer-follow parallax.
- Forced delays while provider content is ready.
- Fake loading bars.
- Sound in v1.
- Haptics.
- Gamepad support in v1.

## 15. Transition latency contract

After room assets are ready:

- Hover/focus response begins within one animation frame.
- Object acknowledgment resolves in roughly 120–180ms.
- Camera/object approach is bounded to roughly 350–550ms.
- Match cut resolves in roughly 180–300ms.
- Readable screen appears within 700ms of committed selection when its code is
  cached.
- Provider data may continue loading in a clearly labeled screen state.

These are interaction gates, not project schedule estimates.

Reduced motion skips approach and match-cut animation entirely.

## 16. History and navigation behavior

Use real routes and browser history as the authoritative navigation model.

- Opening an object pushes its route once.
- Browser Back returns to `/play`.
- `Back to room` uses router navigation consistent with history.
- Re-selecting the current object does not add a duplicate entry.
- Direct route entry makes `Back to room` navigate to `/play` even when no prior
  room history entry exists.
- Route changes preserve query-based comparison mode only in local/test builds.
- Production modes remain server-allowlisted.
- Avoid scroll jumps during room-to-object transitions.

If persistent layout behavior proves unreliable under the exact Vinext build,
use same-document History API state as a prototype bridge, but keep the final
URL contract and direct server routes.

## 17. Focus management

Room object selection is a substantial context change.

### 17.1 Opening

- Save the invoking semantic object's ref.
- Dispatch selection and start transition.
- When the unique interface becomes readable, focus its visible heading with
  `tabindex="-1"` or the `Back to room` control according to content structure.
- Do not wait for provider data to move focus.
- Announce `Opened Watch · MyAnimeList` or equivalent once.

### 17.2 Closing

- Unmount or hide the object screen.
- Restore room overview or 2D fallback.
- Restore focus to the invoking object control.
- If that object no longer exists, focus the nearest valid object or room
  heading.

### 17.3 Screen containment

Object screens are route views, not modal dialogs. Do not trap focus unless a
separate consent/player dialog is open. Header, footer, and `Back to room` remain
available.

## 18. The room object platform

The implementation consists of:

1. Serializable room and object definitions.
2. A client-only allowlisted screen-loader registry.
3. One typed reducer.
4. One validated room scene.
5. One object-specific screen module per object.
6. A fallback representation per object.
7. A test and attestation contract.

Extensibility is compile-time and reviewable. It is not a remote plug-in system.

Do not allow:

- Runtime string imports.
- D1-provided component names.
- Remote scripts.
- Executable GLB metadata.
- Provider-selected modules.
- Arbitrary URLs in the room manifest.

## 19. Serializable object definition

```ts
export type RoomObjectId = string & { readonly __roomObjectId: unique symbol };

export type RoomObjectDefinition<Id extends string = string> = {
  id: Id;
  slug: string;
  order: number;
  label: string;
  actionLabel: string;
  shortDescription: string;

  device:
    | "broadcast-tv"
    | "bookshelf"
    | "pocket-player"
    | "record-crate"
    | "beige-computer"
    | "cardio-tv"
    | "custom";

  accent: "work" | "anime" | "reading" | "motion";

  dataSource:
    | { kind: "connector"; provider: PublicConnectorId }
    | { kind: "static"; collectionId: string }
    | { kind: "unavailable"; reason: string };

  scene: {
    zoneId: string;
    slotId: string;
    rootNode: string;
    visualNode: string;
    hitNodes: readonly [string, ...string[]];
    occluderNodes: readonly string[];
    indicatorNodes: readonly string[];
    overviewAnchor: string;
    approachCameraAnchor: string;
    approachTargetAnchor: string;
    focusCameraAnchor: string;
    focusTargetAnchor: string;
    detailAssetKey?: string;
  };

  interaction: {
    revealPreset:
      | "crt-sync"
      | "spine-pull"
      | "player-wake"
      | "sleeve-rise"
      | "desktop-boot"
      | "signal-lock"
      | "custom";
    neighbors: SpatialNeighbors;
    primaryVerb: string;
  };

  fallback: {
    posterRegionId: string;
    iconKey: string;
    heading: string;
    summary: string;
  };
};
```

Definition rules:

- IDs and slugs are permanent and never recycled.
- Labels are source literals, not provider fields.
- Every route maps to exactly one object.
- Every object maps to exactly one screen loader.
- Data sources are classified explicitly.
- Scene nodes are exact allowlisted names.
- Fallbacks are complete before 3D is considered.
- No definition contains profile identifiers, tokens, raw provider URLs, raw
  HTML, or snapshot content.

## 20. Screen plug-in contract

Executable screen code lives in a separate client-only literal registry.

```ts
export type RoomScreenProps<Id extends string> = {
  object: ExtractRoomObject<Id>;
  headingId: string;
  statusId: string;
  onBackToRoom: () => void;
};

export type RoomScreenModule<Id extends string> = {
  default: React.ComponentType<RoomScreenProps<Id>>;
};

export type RoomScreenPlugin<Id extends string> = {
  id: Id;
  loadScreen: () => Promise<RoomScreenModule<Id>>;
};
```

```ts
export const roomScreenPlugins = {
  watch: {
    id: "watch",
    loadScreen: () => import("../room-screens/watch/WatchRoomScreen"),
  },
  read: {
    id: "read",
    loadScreen: () => import("../room-screens/read/ReadRoomScreen"),
  },
  listen: {
    id: "listen",
    loadScreen: () => import("../room-screens/listen/ListenRoomScreen"),
  },
  collect: {
    id: "collect",
    loadScreen: () => import("../room-screens/collect/CollectRoomScreen"),
  },
  play: {
    id: "play",
    loadScreen: () => import("../room-screens/play/PlayRoomScreen"),
  },
  move: {
    id: "move",
    loadScreen: () => import("../room-screens/move/MoveRoomScreen"),
  },
} satisfies RoomScreenPluginRegistry;
```

Literal import paths allow independent chunks and prevent user/provider values
from choosing executable code.

Screen plug-ins may import:

- Existing public provider client components.
- Their own scoped CSS.
- Shared semantic status, consent, pagination, and attribution primitives.
- Their own safe transition adapter.

Screen plug-ins may not import:

- Three.js or R3F.
- Server repositories.
- D1 or Worker code.
- Runtime secrets.
- OAuth code.
- Another object screen.
- Arbitrary remote assets.

## 21. Unique screen requirement

The screen registry is not permission to produce six copies of one wrapper.

Each plug-in must define:

- A distinct information composition.
- A distinct physical frame or element.
- A distinct collection browsing metaphor.
- A distinct selected-item treatment.
- A distinct entry and exit surface.
- A distinct empty/unavailable state.

Shared semantics remain consistent:

- Back is visible and predictable.
- Provider name and attribution are visible.
- Search has a visible label.
- Filters use native semantics.
- Pagination controls remain predictable.
- Status wording stays consistent.
- Focus and keyboard behavior remain conventional.
- Consent remains explicit.

Unique visual systems do not mean six unique accessibility systems.

## 22. Room zones and extension slots

The room must support growth without pretending it has infinite visual capacity.

```ts
type RoomZone = {
  id: string;
  label: string;
  overviewCameraAnchor: string;
  overviewTargetAnchor: string;
  slots: readonly RoomSlot[];
};

type RoomSlot = {
  id: string;
  parentNode: string;
  transformNode: string;
  footprint: "small" | "medium" | "large" | "wall" | "shelf";
  maxBounds: readonly [number, number, number];
  occupiedBy?: RoomObjectId;
};
```

Initial zones:

- Broadcast corner.
- Reading wall.
- Listening dock.
- Record floor area.
- Computer desk.
- Movement corner.

The base room asset may include a bounded set of empty extension anchors. A new
object can occupy a compatible empty slot without changing the room engine.

When the room exceeds roughly ten to twelve interactable objects, conduct an
architecture and comprehension review. Extensibility does not justify shrinking
targets, overlapping labels, or filling the room with indistinguishable props.

Future growth options:

- Add a close-up zone such as desk or shelf.
- Add a second room through the same platform.
- Rotate curated object sets between deployments.
- Keep low-value objects in a semantic directory without adding them spatially.

## 23. Component architecture

```text
app/play/layout.tsx
└── PlayRoomLayout
    └── RoomExperienceProvider

app/play/page.tsx
└── RoomOverviewPage

app/play/[objectSlug]/page.tsx
└── RoomObjectPage

components/play/room-platform/
  RoomExperience.tsx
  RoomExperienceContext.tsx
  RoomObjectDirectory.tsx
  RoomObjectRouteResolver.ts
  ActiveRoomScreen.tsx
  RoomScreenBoundary.tsx
  RoomVisualStatus.tsx
  room-object-definitions.ts
  room-screen-plugins.client.ts
  room-reducer.ts
  room-routing.ts

components/play/room-screens/
  watch/WatchRoomScreen.tsx
  read/ReadRoomScreen.tsx
  listen/ListenRoomScreen.tsx
  collect/CollectRoomScreen.tsx
  play/PlayRoomScreen.tsx
  move/MoveRoomScreen.tsx

components/play/room-3d/
  Room3DGate.tsx
  load-room-3d.client.ts
  RoomCanvas.tsx
  RoomScene.tsx
  RoomInteractionController.tsx
  RoomCameraRig.tsx
  RoomObjectStateRig.tsx
  RoomTransitionController.ts
  resolve-room-nodes.ts
  room-capability.ts
  dispose-room.ts

components/play/object-primitives/
  ObjectBackLink.tsx
  ObjectStatus.tsx
  ObjectAttribution.tsx
  ObjectSearch.tsx
  ObjectPagination.tsx
  ObjectConsent.tsx

content/presentation/
  play-room-objects.v1.json
  play-room-assets.attestation.json

assets-source/play/my-room-2001/
  my-room-2001.blend
  objects/
  README.md

public/play/my-room-2001/
  room-shell.<hash>.glb
  room-poster.<hash>.avif
  room-poster.<hash>.webp
  objects/

scripts/
  export-play-room-assets.mjs
  validate-play-room-assets.mjs
```

Only `components/play/room-3d/**` may import `three`,
`@react-three/fiber`, or GLTFLoader.

## 24. Server/client boundary

### Server responsibilities

- Validate object route slugs.
- Resolve published/hidden presentation policy.
- Render unique object metadata and semantic foundations.
- Render the room introduction, object directory, and no-JavaScript fallbacks.
- Resolve experiment mode allowlisting.
- Never import renderer code.
- Never expose loader registry internals.

### Client platform responsibilities

- Own room interaction state.
- Synchronize route, selection, focus, screen, and room.
- Dynamically load the selected screen.
- Request only the selected provider.
- Load the room only after capability and explicit intent.
- Handle Back, Escape, transition cancellation, and focus restoration.

### 3D runtime responsibilities

- Load validated first-party assets.
- Resolve exact room-object node mappings.
- Perform bounded pointer hit testing.
- Render hover, focus, selected, and approach states.
- Move the camera through authored poses.
- Report only safe typed events to the platform.
- Stop rendering at rest.
- Dispose on exit or failure.

### Screen responsibilities

- Present one unique object interface.
- Compose an existing public connector component or approved static source.
- Preserve provider terms, attribution, consent, and public projections.
- Never control the room or choose arbitrary endpoints.

## 25. Room state machine

Use a typed reducer, not another state-machine dependency.

```ts
type RoomExperienceState = {
  mode: RoomMode;
  focusedObject: RoomObjectId | null;
  hoveredObject: RoomObjectId | null;
  selectedObject: RoomObjectId | null;
  invokingObject: RoomObjectId | null;
  selectionRevision: number;

  room: {
    phase:
      | "ineligible"
      | "available"
      | "loading"
      | "ready"
      | "transitioning"
      | "suspended"
      | "failed"
      | "disposed";
    transitionEpoch: number;
    safeFailure: RoomSafeFailure | null;
  };

  screen: {
    objectId: RoomObjectId | null;
    phase: "idle" | "loading" | "ready" | "failed";
    loadRevision: number;
  };
};
```

Events:

```ts
type RoomExperienceEvent =
  | { type: "ENTER_ROOM" }
  | { type: "ROOM_READY" }
  | { type: "ROOM_FAILED"; reason: RoomSafeFailure }
  | { type: "FOCUS_OBJECT"; id: RoomObjectId | null }
  | { type: "HOVER_OBJECT"; id: RoomObjectId | null }
  | {
      type: "OPEN_OBJECT";
      id: RoomObjectId;
      source: "scene" | "directory" | "route" | "programmatic";
    }
  | { type: "APPROACH_SETTLED"; id: RoomObjectId; epoch: number }
  | { type: "SCREEN_READY"; id: RoomObjectId; revision: number }
  | { type: "SCREEN_FAILED"; id: RoomObjectId; revision: number }
  | { type: "CLOSE_OBJECT"; source: "back" | "escape" | "browser" }
  | { type: "RETURN_SETTLED"; epoch: number }
  | { type: "ELIGIBILITY_LOST" }
  | { type: "CONTEXT_LOST" }
  | { type: "DISPOSE" };
```

`OPEN_OBJECT` is atomic:

- Validate ID against compiled definitions.
- Set selected object immediately.
- Increment route/screen/transition revisions.
- Begin route navigation.
- Mount only the selected screen loader.
- Begin selected provider work when the screen mounts.
- Update the scene target and selected state.
- Begin motion from actual current transforms.
- Ignore stale loader or transition completions.

## 26. State invariants

- At most one selected object.
- At most one mounted object screen.
- At most one active provider request family.
- The route slug and selected object agree after navigation settles.
- The room may be unavailable while the object screen remains available.
- The object screen may fail while the room remains usable.
- Hover never changes route or loads a screen.
- Focus never loads a provider until activation.
- A stale screen import cannot replace the current screen.
- A stale transition callback cannot move the current camera.
- Closing always has a deterministic focus destination.
- Provider failure never changes room phase.

## 27. Dynamic loading graph

```text
base /play
├── server HTML
├── object definitions
├── semantic object directory
├── static room poster
└── minimal room platform state

after Enter room
├── Three.js + R3F runtime chunk
├── room shell GLB
└── low-detail registered object assets

after object selection
├── selected object screen chunk
├── selected provider JSON
├── selected provider artwork
└── optional selected object detail GLB

after provider-specific consent
└── one approved third-party iframe
```

Zero work on hover:

- Do not load a screen chunk on hover.
- Do not load provider data on hover.
- Do not load object detail assets on hover.
- Do not prefetch all object routes from the directory.

Dynamic imports cannot be reliably aborted. Use object ID plus load revision to
ignore stale resolutions.

## 28. Scene asset architecture

Use two asset tiers so future objects do not permanently inflate every screen.

### 28.1 Core room asset

Loaded after explicit `Enter room`:

- Room shell.
- Static architecture.
- Low-detail versions or anchors for registered objects.
- Simplified hit proxies.
- Camera and target anchors.
- Indicator nodes.
- Extension slot anchors.
- No provider data.

### 28.2 Object detail assets

Loaded only after that object is committed:

- Close-up knobs, dividers, book groups, keys, or screen hardware.
- Geometry used only during approach or match cut.
- No provider artwork or metadata.
- A neutral transition still works if the detail asset fails.

The room overview must remain recognizable without detail packs.

## 29. GLB naming contract

Use explicit names, not prefix discovery as runtime configuration.

```text
ROOM__root
ROOM__shell

ZONE__broadcast
ZONE__reading
ZONE__listening
ZONE__records
ZONE__desk
ZONE__movement

OBJ__watch
  VIS__watch
  HIT__watch__screen
  HIT__watch__body
  STATE__watch__power
  CAM__watch__approach
  TARGET__watch__approach
  CAM__watch__focus
  TARGET__watch__focus

OBJ__read
  VIS__read
  HIT__read__shelves
  STATE__read__spine
  CAM__read__approach
  TARGET__read__approach
  CAM__read__focus
  TARGET__read__focus

OBJ__listen
OBJ__collect
OBJ__play
OBJ__move

OCC__desk_front
SLOT__wall_01
SLOT__shelf_01
SLOT__floor_01
```

The checked-in manifest maps exact names to object IDs. GLB names do not choose
screen modules or routes.

## 30. Runtime node resolution

On room load:

1. Load the fixed, content-hashed GLB URL from the generated asset manifest.
2. Index nodes by exact name.
3. Reject duplicate required names.
4. Require every mapped root, visual, hit, indicator, camera, and target node.
5. Verify hit/indicator nodes descend from the correct object root.
6. Ignore embedded cameras, lights, and animations not explicitly allowed.
7. Strip or ignore unexpected custom properties.
8. Clone hit proxies onto the interaction layer.
9. Build a closed UUID-to-object map.
10. Fail only the 3D enhancement on mismatch.

No runtime node value is interpreted as:

- A URL.
- An import path.
- A provider.
- A route.
- HTML.
- A credential.

## 31. Hit proxies and occlusion

Interactive objects use simplified hit geometry.

- Hit proxies are larger than small visible controls.
- Hit proxies remain within the object's obvious silhouette.
- Multiple proxies may map to one object.
- Total proxies remain bounded.
- Proxy meshes are invisible and excluded from the render camera layer.
- Raycaster sees only hit and occluder layers.

When a foreground surface could hide an object, use a simplified `OCC__*` proxy.
Intersect hit and occluder proxies together. Accept a selection only when the
nearest valid intersection is a hit target.

Art direction should still minimize overlap. Occluder logic is defense, not a
substitute for readable composition.

## 32. Pointer algorithm

```ts
type PointerIntent =
  | { kind: "idle" }
  | {
      kind: "pending";
      pointerId: number;
      downObject: RoomObjectId | null;
      origin: readonly [number, number];
      previous: readonly [number, number];
      viewAtStart: RoomViewPose;
    }
  | {
      kind: "dragging";
      pointerId: number;
      previous: readonly [number, number];
      viewAtStart: RoomViewPose;
    };
```

Algorithm:

1. Route all eligible room pointer input through one `RoomPointerRouter`.
2. In normal perspective mode, convert client coordinates from stage bounds to
   normalized device coordinates and raycast the fixed proxy list.
3. In fisheye mode, consume the reviewed projection-aware R3F intersections;
   never reuse the undistorted camera ray.
4. Resolve the nearest unoccluded registered object.
5. On ordinary `pointermove`, update hover at most once per animation frame.
6. On `pointerdown`, create a pending intent and capture mouse/pen input.
7. Remain pending inside the 8 CSS-pixel dead zone.
8. Beyond the dead zone, cancel the object candidate and rotate only the room
   presentation group inside the exact bounds from Section 33.
9. On a pending `pointerup`, require matching pointer and object, dispatch
   `OPEN_OBJECT`, and synchronize the matching semantic control.
10. On a dragging `pointerup`, commit only the new bounded view pose.
11. Clear state on cancellation, route change, hidden document, context loss,
    resize, or lost capture.

Do not attach independent handlers to arbitrary visible model meshes.

## 33. Camera system

The reference is not mathematically isometric. Strict isometric projection is
orthographic; the desired miniature curvature comes from a perspective scene
with optional fisheye projection. Use a perspective camera and rotate the room
presentation group for the overview gesture. Camera distance, FOV, target,
fisheye zoom, and roll remain fixed while dragging.

```ts
type RoomViewPose = {
  azimuthOffsetDeg: number;
  polarOffsetDeg: number;
};

const ROOM_VIEW_LIMITS = {
  azimuthOffsetDeg: [-12, 12],
  polarOffsetDeg: [-7, 7],
  keyboardStepDeg: 4,
} as const;
```

These are greybox limits, not an invitation to widen the scene. Change them
only if every object remains visible, legible, and accurately selectable at the
new extremes. `Reset view` restores `{azimuthOffsetDeg: 0, polarOffsetDeg: 0}`.

Each object has authored poses:

```text
overview
  → optional approach waypoint
    → approach
      → focus
        → match cut
```

Camera paths are authored, not derived from object bounds. This avoids walls,
occlusion, nausea, and inconsistent framing.

Transition algorithm:

1. Cancel current Anime.js transition.
2. Capture actual camera position, quaternion, target, and zoom.
3. Capture selected object transform and indicator state.
4. Increment transition epoch.
5. Interpolate one normalized scalar across authored segments.
6. Call R3F `invalidate()` on each update.
7. Ignore stale epoch callbacks.
8. Snap exact final values.
9. Stop invalidation.

Never fly through walls or perform a first-person walk.

The room drag is an optional overview presentation control, not a camera path.
Selecting an object freezes it, then starts the authored approach from the
actual current pose. Browser Back restores the saved overview pose before
returning focus to the invoking object.

## 34. Canvas-to-DOM match cut

The handoff must feel like the same object, without attempting to render real DOM
inside WebGL.

### 34.1 Contract

- Final 3D frame presents one simple transition surface.
- CSS/SVG screen begins with a visually matched surface.
- Canvas dims or is covered.
- Semantic screen appears.
- Room rendering suspends.

### 34.2 Object surfaces

- Watch: CRT sync line.
- Read: advancing spine edge.
- Listen: pocket-player display rectangle.
- Collect: rising sleeve edge.
- Play: generic desktop window.
- Move: `No signal` television field.

### 34.3 Prohibition

Do not continuously align a DOM rectangle to a moving 3D plane. Do not use
CSS3DRenderer. Use a short authored match cut with deterministic start/end
states.

## 35. Anime.js orchestration

Anime.js is the only motion runtime outside R3F invalidation.

Each object plug-in declares a reviewed transition preset. Custom transitions
must implement the same cancellation and reduced-motion contract.

```ts
type ObjectTransitionAdapter = {
  acknowledge(context: TransitionContext): AnimationHandle;
  approach(context: TransitionContext): AnimationHandle;
  open(context: TransitionContext): AnimationHandle;
  close(context: TransitionContext): AnimationHandle;
  return(context: TransitionContext): AnimationHandle;
  snap(state: "overview" | "object"): void;
  dispose(): void;
};
```

New selection:

1. Cancel active handles.
2. Read actual current values.
3. Increment epoch.
4. Resolve scene and DOM to valid intermediate states.
5. Begin new transition.
6. Snap exact endpoint.

Reduced motion invokes `snap` without loading the 3D runtime.

## 36. Shared screen lifecycle, not shared screen design

`RoomScreenBoundary` owns lifecycle only:

```tsx
<RoomScreenBoundary
  object={definition}
  headingId={headingId}
  statusId={statusId}
  onBack={returnToRoom}
>
  <LazyObjectScreen />
</RoomScreenBoundary>
```

It provides:

- One visible `Back to room` action.
- Heading and status identifiers.
- Focus entry and restoration.
- Loading text.
- Safe module failure.
- Route consistency.
- Provider attribution placement constraints.

It must not render:

- A generic card.
- A generic device bezel.
- A generic header band.
- A common two-column layout.
- A shared metric rail.
- A one-size-fits-all gallery.

The child screen owns the visible composition.

## 37. Watch object — Midnight Broadcast

### 37.1 Room object

An original graphite 4:3 television sits in the broadcast corner on a small A/V
shelf. It has:

- A smoked-glass screen.
- One physical channel control.
- One power control.
- Vent and screw details.
- A cobalt/magenta channel indicator.
- No anime artwork or provider logo in the room.

### 37.2 Hover and focus

- Power indicator illuminates.
- Screen glass lifts slightly above black.
- Visible DOM label says `Television · Watch`.
- No static, flicker, or sound.

### 37.3 Approach

1. Channel control rotates a small amount.
2. Screen field brightens.
3. Camera approaches from the authored angle.
4. Screen contracts to one safe horizontal line.
5. Line fills the transition surface.
6. CSS/SVG television screen opens.

### 37.4 Unique interface

The Watch interface is a semantic broadcast system:

- 4:3 primary program area.
- Watch-state channels.
- Genre and era guide.
- Cover atlas as a programming grid.
- Recent accepted activity as `Recently in the archive`, not necessarily `Now
  airing`.
- Search as a channel index.
- Item detail as a program card, not a generic modal.
- Provider link and last-sync state in a quiet broadcast footer.

### 37.5 Data rules

- Use only accepted MyAnimeList public snapshot fields.
- Cover art remains through the existing artwork endpoint.
- Titles, states, genres, years, and approved patterns remain semantic HTML.
- Do not infer live viewing, time watched, popularity, or taste score.

### 37.6 Motion rules

- Static scanline texture is allowed behind empty areas only.
- No rolling scanline over text or artwork.
- No white flash.
- No brightness flicker.
- Channel changes use a bounded vertical sync wipe.

### 37.7 Exit

- Active program view contracts into the sync line.
- CSS screen gives way to the 3D screen line.
- Television powers to idle.
- Camera returns to overview.
- Focus returns to Television.

### 37.8 Safe failure

`No signal` remains readable HTML with connector status and profile link. Do not
animate noise or imply credentials are missing when only the snapshot is stale.

## 38. Read object — Borrowed Shelf

### 38.1 Room object

A wood-veneer and powder-coated bookshelf occupies the reading wall. It has:

- Several generic, non-readable book groups.
- Paper shelf labels.
- One amber reading lamp.
- Clear negative space around the selectable shelf.
- No actual cover or title texture in the room asset.

### 38.2 Hover and focus

- One generic spine advances slightly.
- Amber shelf marker illuminates.
- DOM label says `Bookshelf · Read`.
- Other books do not wobble.

### 38.3 Approach

1. Camera approaches the shelf at an oblique but readable angle.
2. One generic spine advances.
3. Its edge expands into a vertical transition plane.
4. The plane becomes the first semantic shelf divider.
5. The Bookshelf interface resolves.

### 38.4 Unique interface

The Read interface is an actual shelf system:

- Reading, Finished, and Want to Read are physical shelf sections.
- Desktop may show semantic spines where every title remains readable.
- Mobile and zoomed layouts show front-facing covers.
- Search resembles a compact library index.
- Era/status patterns appear as library labels.
- Selected book advances into a reading leaf with metadata and link.
- Covers are never decoratively cropped or filtered.

### 38.5 Data rules

- Use only the approved Hardcover public snapshot.
- Do not map spine height, width, or color to a field unless coverage is complete
  and the mapping is labeled.
- Do not infer reading speed, completion date, rating, or taste.

### 38.6 Motion rules

- One selected book may advance.
- Immediate neighbors may compress slightly.
- Shelf reflow must not cause layout shift outside its bounded region.
- No physics, falling books, page flutter, or ambient wobble.

### 38.7 Exit

- Selected book returns to its semantic shelf.
- Shelf edge becomes the 3D transition spine.
- Spine returns.
- Camera returns to overview.
- Focus returns to Bookshelf.

### 38.8 Safe failure

Use a labeled empty shelf section with the existing connector status and profile
link. Missing artwork uses the current neutral typographic fallback.

## 39. Listen object — Pocket Player

### 39.1 Room object

An original translucent nano-era pocket player sits in a small charging dock.
It has:

- A smoked translucent shell.
- A small square display.
- An original circular/directional control that avoids exact Apple geometry.
- A dock indicator.
- No Spotify logo, art, title, or account identity in the room.

### 39.2 Hover and focus

- Dock indicator illuminates.
- Device tilts a few degrees or rises slightly.
- DOM label says `Pocket player · Listen`.
- No equalizer animation.

### 39.3 Approach

1. Player rises from the dock.
2. Screen shows one equal ordinal mark.
3. Camera approaches.
4. Device display fills the transition region.
5. CSS/SVG pocket player takes over.
6. Ranked Groove resolves.

### 39.4 Unique interface

The Listen interface is a pocket-player system:

- Ranked Groove is the primary track selector.
- Short, medium, and long official windows appear as a physical side switch or
  menu.
- Cover gallery is a secondary mode.
- One inspector displays rank, track, artist, album, year, duration, and explicit
  indicator.
- `Listen on Spotify` remains the primary external action.
- `Listen here` opens one consent-gated official embed.

### 39.5 Data rules

- Preserve Spotify's returned ordinal order.
- Equal marks remain visually equal.
- Do not derive play count, rank change, overlap, trend, genre, audio feature,
  popularity, composite score, or artwork color.
- Do not animate artwork or metadata.

### 39.6 Playback rules

- No autoplay.
- No custom audio controls.
- No Web Audio API.
- No playback SDK.
- One official iframe at a time.
- The 3D room is suspended while the screen is open.
- Audio never changes the room, device, light, or visualizer.

### 39.7 Exit

- Official player is removed or paused according to existing behavior.
- Ranked Groove resolves to a static selected mark.
- Display sleeps.
- 3D player returns to dock.
- Camera returns.
- Focus returns to Pocket player.

### 39.8 Safe failure

If Top Tracks are unpublished or expired, show the approved official fallback
embed or profile link inside the pocket-player composition.

## 40. Collect object — Record Crate

### 40.1 Room object

A black milk crate sits in the record area with generic sleeves and dividers.
It has:

- Recognizable crate openings.
- Generic record edges.
- Format/decade divider forms with no readable collection data.
- A stable floor footprint.
- No album covers in the GLB.

### 40.2 Hover and focus

- One divider rises.
- Crate edge receives a restrained marker.
- DOM label says `Record crate · Collect`.
- No sleeve fan before activation.

### 40.3 Approach

1. Camera lowers toward the crate.
2. Dividers separate.
3. One generic sleeve rises.
4. Sleeve edge fills the transition region.
5. Semantic crate interface opens.

### 40.4 Unique interface

The Collect interface behaves like a record crate:

- Format or decade dividers organize the collection.
- Sleeves move one at a time through standard controls.
- Search and sorting appear as crate labels.
- Pattern view is an accessible format × decade matrix.
- Duplicate copies may be represented only through approved `copyCount`.
- Title, artist, year, format, copy count, link, and sync state remain HTML.

### 40.5 Data rules

- Discogs remains unavailable until its separate connector is implemented and
  published.
- Do not fabricate collection data for the visual prototype.
- Do not expose covers, acquisition dates, notes, ratings, folders, condition,
  pricing, marketplace, sales, or account identifiers.
- Do not infer rarity, value, taste, or collection chronology.

### 40.6 Motion rules

- One selected sleeve rises.
- Prev/Next and arrow controls remain primary.
- No required drag interaction.
- No physics or shuffling stack.

### 40.7 Exit

- Selected sleeve lowers.
- Dividers return.
- Transition edge becomes the 3D sleeve.
- Camera returns.
- Focus returns to Record crate.

### 40.8 Safe failure

Before Discogs is connected, the object can be present but opens a deliberately
designed `Collection not connected` crate label. It performs no provider request
and shows no fake totals.

## 41. Play object — Beige Computer

### 41.1 Room object

An original beige desktop setup occupies the desk:

- Tower.
- CRT monitor.
- Simplified keyboard.
- Mouse.
- Small desk and chair.
- Generic screen field.
- No Windows, Apple, Steam, game, or account branding.

### 41.2 Hover and focus

- CRT power light illuminates.
- Cursor-like block appears on the generic screen.
- Chair or monitor aligns subtly.
- DOM label says `Computer · Play`.

### 41.3 Approach

1. Monitor powers on.
2. One brief boot line appears.
3. Camera approaches the desk.
4. A generic desktop window expands.
5. CSS/SVG computer interface replaces it.

### 41.4 Unique interface

The Play interface is a compact late-1990s desktop:

- Games appear as semantic shortcuts, folders, or a file list.
- Recent games become `Recently opened` only when supported.
- Rounded playtime may appear as a labeled disk-use measure.
- Selecting a game opens one detail window.
- Search resembles a file finder.
- Gallery mode uses official icon metadata through the existing artwork path.

### 41.5 Data rules

- Publish only the approved Steam snapshot.
- Do not expose exact minutes, presence, friends, bans, achievements,
  inventories, real name, location, or account identifiers.
- Do not reproduce Steam client UI.

### 41.6 Motion rules

- One bounded power-on.
- No fake slow boot.
- No typing simulation.
- No draggable window requirement.
- No system sounds.
- No idle cursor motion.

### 41.7 Exit

- Detail window closes.
- Desktop resolves to boot line.
- 3D monitor powers to idle.
- Camera returns.
- Focus returns to Computer.

### 41.8 Safe failure

Show a readable offline desktop note and profile link. Do not imitate a crash or
display a fake error code.

## 42. Move object — Cardio Television

### 42.1 Room object

A treadmill with mounted television/console occupies the movement corner:

- Recognizable belt and rails.
- Compact display.
- Mint status indicator.
- Clear silhouette.
- No route, map, pace, distance, or athlete data in the room.

### 42.2 Hover and focus

- Display wakes to a neutral field.
- Belt advances only a few pixels or the console tilts slightly.
- DOM label says `Treadmill TV · Move`.
- No implied pace.

### 42.3 Approach

1. Camera approaches the console.
2. Television tilts into view.
3. `No signal` field fills the screen.
4. Semantic cardio-TV interface opens.

### 42.4 Unique interface

The Move interface is a television mounted to a treadmill:

- Profile explanation and consent appear before third-party content.
- A working official Strava profile feed occupies the television area.
- Failing/unavailable feed becomes one prominent profile link.
- Provider status stays readable outside decorative glass effects.
- Individual activity/route embeds remain optional highlights only.

### 42.5 Data rules

- Do not build a custom public Strava API visualization.
- Do not infer pace, speed, distance, training load, route, or performance.
- Use only the validated public profile and official embed configuration.

### 42.6 Motion rules

- Consent may power on the display.
- Decorative belt movement stops immediately after the transition.
- No ongoing motion tied to iframe activity.

### 42.7 Exit

- Third-party iframe is removed where existing lifecycle requires it.
- Screen returns to `No signal`.
- 3D television returns to idle.
- Camera returns.
- Focus returns to Treadmill TV.

### 42.8 Safe failure

If the embed redirects to sign-in or cannot frame, show the profile link and do
not repeatedly retry.

## 43. Future object examples

The platform may later support meaningful additional objects, such as:

- A camera that opens a reviewed public photo collection.
- A sketchbook that opens public design studies.
- A console that opens another approved game library.
- A stack of notebooks that opens public notes or essays.
- A wall poster that opens one curated project archive.
- A physical award or badge that opens verified evidence.

These are examples, not approved data sources.

A decorative plant, lamp, window, wall, floor, bed, cable, or chair should remain
decorative unless it has a meaningful destination. Do not create fake
interaction merely to make the room feel busy.

## 44. Adding a new object

Adding a seventh object requires all of the following:

1. Permanent object ID.
2. Permanent route slug.
3. Source-controlled definition.
4. Classified and already-approved data source, or explicit unavailable state.
5. Unique semantic object screen.
6. Literal screen loader entry.
7. Room zone and compatible slot.
8. Low-detail room model or placeholder.
9. Simplified hit proxy.
10. Approach/focus camera and target anchors.
11. Object-specific match-cut surface.
12. Mobile/static representation.
13. No-JavaScript foundation.
14. Forced-colors and reduced-motion design.
15. Updated asset attestation.
16. Registry, route, asset, input, provider, accessibility, and visual tests.

If the object requires a new provider, OAuth flow, storage, artwork origin,
iframe, or retention behavior, that connector remains a separate reviewed
change. Presentation code cannot quietly create a connector.

## 45. Removing or hiding an object

- D1 may hide or order allowlisted objects if the existing editorial policy is
  explicitly extended and validated.
- D1 cannot add a route, plug-in, node, module, provider, or data source.
- Hidden objects are omitted from room selection and semantic directory.
- Hidden objects must not issue requests or load detail assets.
- Removing an externally linked route requires a redirect or an explicitly
  accepted compatibility break.
- IDs are never reused.
- Asset nodes, loader, fallbacks, and tests are removed together.

## 46. Capacity and room legibility

The plug-in architecture does not imply unlimited simultaneous objects.

Initial capacity target:

- Six core objects.
- Up to four additional objects only after comprehension testing.
- Minimum clear pointer target in the overview.
- No overlapping accessible labels.
- No object hidden entirely behind another.
- No more than one level of room-zone selection in v1.

At more than roughly ten to twelve interactables:

- Re-evaluate room composition.
- Consider a second room or close-up zone.
- Consider curated rotation.
- Preserve the semantic directory.
- Do not shrink objects or hotspots to force capacity.

## 47. Renderer selection

Use exact-pinned `three` and a tested React Three Fiber 9.x release compatible
with React 19.2. Add an exactly compatible, exactly pinned `@react-three/drei`
only for the reviewed `Fisheye` and `PresentationControls` primitives. Do not
import Drei through a broad barrel into unrelated client modules.

R3F is justified because the room now has:

- A nested authored scene.
- Multiple object groups.
- Pointer hit testing.
- Authored camera anchors.
- Per-object hover/selected state.
- Lazy detail assets.
- Demand-based rendering.
- Complex cleanup and context-loss behavior.

Use one canvas and one renderer:

```tsx
const radians = (degrees: number) => (degrees * Math.PI) / 180;

<Canvas
  dpr={[1, 1.25]}
  frameloop="demand"
  camera={{
    fov: 54,
    near: 0.1,
    far: 50,
    position: [5.5, 4.5, 7.5],
  }}
  gl={{
    alpha: true,
    antialias: false,
    depth: true,
    stencil: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  }}
>
  <Fisheye resolution={512} segments={32} zoom={0.2}>
    <PresentationControls
      global={false}
      zoom={1}
      rotation={[0, -Math.PI / 4, 0]}
      polar={[-radians(7), radians(7)]}
      azimuth={[-radians(12), radians(12)]}
    >
      <RoomScene />
    </PresentationControls>
  </Fisheye>
</Canvas>
```

This illustrates the renderer topology; final camera, fisheye, spring, and room
transform values come from the approved greybox. `PresentationControls` is the
first implementation candidate because it creates the soft bounded room motion
used by the visual benchmark. It ships only if the shared pointer router can
enforce the Section 13 dead zone and every drag/click acceptance gate. If the
primitive cannot provide deterministic arbitration, replace its input shell
with a small local controller that drives the same bounded room-group pose; do
not weaken the gates.

`Fisheye` renders a cubemap and therefore performs six scene renders for every
requested frame. It is the high-tier renderer, not the semantic experience:

- Start at 512-pixel resolution and 32 segments.
- Test 384 and 640 as explicit quality variants; never inherit an expensive
  default without measurement.
- Cap DPR at 1.25 in fisheye mode.
- Request frames only during drag, transition, state change, or resize.
- Use baked ambient occlusion and a simple light rig. Do not combine fisheye
  with bloom, SSAO, depth of field, real-time reflections, or dynamic shadow
  passes.
- If active-drag performance or edge hit accuracy misses its gate, render the
  same curved-shell room with the ordinary perspective camera.

No second canvas, second imperative Three.js renderer, `VRCanvas`, XR runtime,
Looking Glass polyfill, physics engine, or general post-processing stack is
allowed.

## 48. Render lifecycle

Request frames only:

- After room asset readiness.
- On hover/focus state change.
- During bounded object/camera transitions.
- After selected detail asset readiness.
- After a real resize.
- After visibility restoration if reconciliation is needed.

At rest, render calls are zero.

When an object screen covers the room:

- Suspend room rendering.
- Remove or disable pointer listeners.
- Preserve selected object and exact camera state.
- Do not animate the room behind content.

On document hide:

- Cancel or suspend transitions.
- Stop invalidation.
- Preserve route and object state.

On return:

- Snap to the route's exact state.
- Render one frame if needed.
- Do not replay missed transitions.

## 49. Capability gate

The 3D room is eligible only when:

- Experience mode is server-allowlisted.
- Visitor explicitly chooses `Enter room`.
- Viewport meets the reviewed desktop threshold, preferably at least 1100–1200
  CSS pixels.
- Primary pointer is fine.
- Reduced motion is not requested.
- Forced colors is not active.
- Save-Data is not enabled where exposed.
- WebGL2 renderer creation succeeds.
- `failIfMajorPerformanceCaveat` does not reject it.
- Stage is visible.
- Document is foregrounded.

Evaluate all non-WebGL eligibility conditions before importing Three.js or R3F.

## 50. Room loading sequence

1. Render complete semantic room directory and static poster.
2. Evaluate capability without 3D imports.
3. Reveal `Enter room` only when eligible.
4. On activation, call a native literal `import()` for the room entry.
5. Create one canvas.
6. Load the content-hashed room shell and low-detail objects.
7. Resolve all required nodes.
8. Compile the small material set.
9. Render one complete overview frame behind the poster.
10. Swap poster to canvas.
11. Announce `Interactive room ready` politely.
12. Focus the last focused object or room heading without stealing focus from an
   unrelated control.

Never reveal an empty or black canvas.

## 51. Asset authoring and provenance

All room and object assets must be original or explicitly licensed for
redistribution and modification.

The source README records:

- Artist/author.
- Ownership and license.
- Mood references and their limited use.
- Blender version.
- Unit scale and coordinate convention.
- Modeling conventions.
- Naming conventions.
- Material/texture inventory.
- Export settings.
- Object-pack relationships.
- Known limitations.
- Source revision.

Prefer original models. Do not download marketplace assets casually.

## 52. Modeling rules

- Maintain consistent real-world scale.
- Apply transforms.
- Remove hidden and unused geometry.
- Remove unused materials and textures.
- Share/instance repeated generic elements.
- Keep hit proxies simplified.
- Avoid subdivision in deployed output.
- Use vertex colors for broad surfaces.
- Use compact texture atlases only where needed.
- Bake ambient-occlusion/light hints.
- Do not use real-time shadows.
- Keep screen materials simple and emissive.
- Do not model readable provider content.
- Do not embed external URIs.
- Do not embed executable metadata.
- Keep object and anchor names stable.

## 53. Export and compression policy

Export binary glTF with:

- Y-up convention.
- Applied modifiers.
- Approved objects only.
- Required custom properties only, preferably none.
- No external resources.
- No unused animations.
- No embedded provider assets.
- No unapproved cameras/lights.
- Runtime-safe extension allowlist.

Do not use Draco, KTX2/Basis, or runtime Meshopt/Wasm in v1. Preserve the strict
CSP. If assets miss budget, simplify assets before proposing a security change.

## 54. Asset validation

The custom validator must fail on:

- Hash mismatch.
- Missing or duplicate required node.
- Incorrect node parentage.
- Object mapped to multiple IDs.
- Missing hit proxy.
- Missing approach/focus camera or target.
- Non-finite transforms.
- Camera placed inside geometry.
- Proxy bounds too small at reference overview.
- Hit proxy budget exceeded.
- File/triangle/draw/material/texture budget exceeded.
- Texture dimension exceeded.
- External URI.
- Unexpected animation.
- Unsupported extension.
- Unexpected custom property.
- Missing provenance.
- Poster mismatch.
- Khronos glTF Validator error.

## 55. Asset attestation

Generate, do not hand-edit:

```json
{
  "schemaVersion": "1.0",
  "experience": "my-room-2001",
  "sourceRevision": "<source-revision>",
  "room": {
    "asset": "room-shell.<hash>.glb",
    "sha256": "<sha256>",
    "triangles": 0,
    "drawGroups": 0,
    "materials": 0,
    "textures": []
  },
  "objects": [],
  "validator": {
    "tool": "Khronos glTF Validator",
    "errors": 0
  }
}
```

The attestation contains no local paths, raw source content, provider data, or
credentials.

## 56. Lighting and materials

Use:

- One hemisphere/ambient light.
- At most one non-shadow-casting key light.
- Baked light hints.
- Vertex colors.
- Simple emissive screen/indicator materials.
- Shared warm off-white, graphite, black, wood, metal, paper, and translucent
  acrylic language.

Do not use:

- Real-time shadow maps.
- Bloom.
- SSAO.
- Depth of field.
- Motion blur.
- Film-grain shader.
- Reflections or mirrors.
- Full-screen CRT shader.
- Provider textures.

## 57. Poster and 2D room map

The static room is a first-class experience, not an error placeholder.

Create:

- AVIF and WebP poster.
- One semantic HTML object directory.
- Optional positioned DOM hotspots over the poster.
- A compact 2D room map for mobile.
- Forced-colors object directory with no reliance on imagery.

Poster hotspot coordinates come from the validated presentation manifest, not
manual CSS scattered across components.

The poster remains visible until a complete 3D frame succeeds and returns on any
room failure.

## 58. Mobile experience

Mobile should still feel exploratory without loading a miniature 3D room.

Use one of two reviewed compositions:

1. A vertically segmented illustrated room with real HTML hotspots, or
2. Stacked room zones with large object illustrations and links.

Requirements:

- No WebGL request.
- No horizontal room pan.
- No pinch interception.
- No touch drag navigation.
- At least 44px primary object targets.
- Two-column object layout where it fits; one column below the narrow threshold.
- Object routes open normal vertical pages.
- Unique screen identity remains intact.
- Browser Back returns to the room map.

Do not call mobile a fallback in user-facing copy.

## 59. No-JavaScript experience

With JavaScript disabled:

- `/play` renders the room introduction, poster/map, and six normal object links.
- Each object route renders a unique static screen foundation.
- Provider profile and attribution links remain available.
- Unavailable state remains honest.
- No dead `Enter room` control appears.
- No empty tab panel appears.
- The page never requires canvas.

Dynamic galleries may require JavaScript, but the object, provider, coverage,
status, and external route remain understandable.

## 60. Reduced motion

Under `prefers-reduced-motion: reduce`:

- Do not offer or load the 3D room.
- Use the static room map.
- Object selection navigates directly to its route.
- Unique interfaces apply final states immediately.
- No sync wipe, spine pull, device wake, sleeve rise, boot, or treadmill motion.
- Focus management and status remain unchanged.

## 61. Forced colors and zoom

### Forced colors

- No WebGL request.
- Remove textures, acrylic, shadows, and color-only indicators.
- Preserve labels, borders, selected state, focus, Back, status, and provider
  attribution.
- Object map becomes ordinary bordered links.

### 200–400% zoom

- Effective layout becomes the mobile/static composition.
- No 3D request.
- No horizontal page overflow.
- Full labels and titles wrap naturally.
- Technical strings may use `overflow-wrap: anywhere`.
- Natural language does not break prematurely.

## 62. Connector and provider boundaries

The room platform does not change connectors.

Provider mapping:

```text
Watch   → MyAnimeList
Read    → Hardcover
Listen  → Spotify
Collect → Discogs, only after separate implementation
Play    → Steam
Move    → Strava configuration/embed path
```

Rules:

- Only selected screen mounts its provider component.
- Hover/focus never requests provider data.
- Room entry never requests provider data.
- Inactive artwork remains unfetched.
- Spotify and Strava frames remain consent-gated.
- Public payload validators remain authoritative.
- Room object IDs never become provider account IDs.
- Provider failure never changes room assets.

## 63. Security and privacy

- All scene code/assets are first-party and content-hashed.
- GLB URL comes only from the checked-in generated manifest.
- Query params, D1, provider data, and GLB metadata cannot select a module or URL.
- Room definitions contain no secrets, identities, or provider payloads.
- Runtime strips/ignores GLB custom properties.
- Scene `userData` contains at most an internally generated opaque object ID.
- Provider content stays in exact public-projected DOM components.
- Artwork remains through approved artwork paths.
- Third-party frames remain exact-origin and consent-gated.
- No remote model, texture, script, or generic proxy.
- No `unsafe-eval` or `wasm-unsafe-eval`.
- No room-selection analytics endpoint.
- No GPU fingerprinting.
- No logging selected object, pointer coordinates, GPU string, provider payload,
  profile, identity, URL, query, OAuth material, or raw exception.
- Dependency, bundle, privacy, and security gates apply to implementation.

## 64. Safe observability

Use local comparison traces for:

- Room code and asset transfer.
- Room activation duration.
- Screen chunk transfer.
- Hit-test duration.
- Draw calls and triangles.
- Transition frame cost.
- Idle frame count.
- Context-loss recovery.
- Provider requests per selection.

Do not send these as personal production analytics.

Existing coarse redacted Worker logging remains sufficient. If a future safe
health event is approved, it may report only a code such as
`room_enhancement_failed`, never the selected object or hardware details.

## 65. Performance budgets

These are hard release gates except where a row is explicitly labeled as an
optimization target:

| Measurement | Maximum or requirement |
| --- | ---: |
| Three/R3F/GLB before room intent | 0 bytes |
| Inactive screen chunks | 0 bytes |
| Inactive provider/artwork requests | 0 |
| Base room-platform JS increase | 12 KB gzip |
| Each screen presentation increment | 30 KB gzip |
| Deferred Three/R3F room renderer | 225 KiB gzip optimization target; 325 KiB gzip hard release ceiling |
| Core room GLB | 1.1 MB |
| Core texture payload | 512 KB |
| Total cold room activation | 2 MB compressed |
| Individual detail asset | 250 KB compressed |
| Visible triangles | 80,000 |
| Draw calls | 75 |
| Materials | 24 |
| Texture allocation | 24 MB approximate |
| Texture max edge | 1024px |
| Hit proxies | 24 |
| Hit-proxy triangles | 3,000 combined |
| Raycast p95 | 4ms on agreed profile |
| Drawing buffer | 2 megapixels |
| DPR | 1.5 maximum |
| Idle render calls | 0 |
| Third-party frames before consent | 0 |
| Object-to-readable cached screen | under 700ms |
| CLS | below 0.1 |
| Mobile Lighthouse performance | at least 90 |

Do not add BVH for the initial six objects. A small fixed proxy list does not
justify another dependency.

The 225 KiB value is the original optimization target, not the release-blocking
limit. The approved implementation plan sets 325 KiB gzip as the hard ceiling.
The bundle gate resolves `RoomStage.tsx` through Vite's client manifest, follows
and de-duplicates its complete transitive static-import closure, and includes
each entry's emitted JavaScript, CSS, and declared assets. It reports that
absolute closure for diagnosis. The hard ceiling applies to the deferred
renderer transfer: files already present in the `RoomRuntime.tsx` pre-render
closure are subtracted because the browser has fetched them before resolving
the RoomStage dynamic import. This still counts any Three/R3F dependency that
Vite splits away from the named RoomStage file, so chunk splitting cannot evade
the gate. Each emitted file is gzipped independently before the transfer sizes
are summed, matching HTTP delivery more closely than gzipping concatenated
files.

Manifest `dynamicImports` are separate conditional fetches and are not part of
the static closure. A future RoomStage-owned dynamic entry requires its own
explicit activation and bundle gate rather than being hidden inside this one.
Exceeding 225 KiB is recorded as optimization debt; exceeding 325 KiB blocks a
release.

## 66. Context loss and failure behavior

On `webglcontextlost`:

1. Cancel all room motion.
2. Stop input and rendering.
3. Remove/unmount canvas.
4. Restore static poster/map.
5. Preserve selected route and object screen.
6. Announce `Interactive room unavailable; all collections remain available.`
7. Do not retry in a loop.

Room failure never becomes provider failure.

Detail-asset failure skips directly to the semantic screen.

Screen-chunk failure shows a safe screen error with retry and `Back to room`.

Provider failure shows the existing provider-safe state inside the unique screen.

## 67. Cleanup contract

Room disposal must:

- Cancel Anime.js handles.
- Remove pointer listeners.
- Disconnect observers.
- Remove visibility/context listeners.
- Abort asset loads where practical.
- Dispose geometries.
- Dispose materials.
- Dispose textures and close `ImageBitmap` objects.
- Dispose render targets.
- Dispose renderer.
- Unmount R3F canvas.
- Clear UUID interaction map.
- Release GLB/node/camera references.
- Clear transition callbacks.

Repeated enter/open/close/route-away cycles must not materially grow
`renderer.info` resources.

## 68. Failure matrix

| Failure | Behavior | Still available |
| --- | --- | --- |
| Mode not allowlisted | Static room and object routes | All object screens |
| Narrow/coarse device | Mobile room map | All object screens |
| Reduced motion | Direct route cuts | All object screens |
| Save-Data | Static room | Selected provider after explicit selection |
| WebGL2 unavailable | Static room | All object screens |
| Room GLB failure | Static room | All object screens |
| Mapping mismatch | Static room | All object screens |
| Context loss | Permanent static room for session | Current screen and routes |
| Detail asset failure | Skip match cut | Selected screen |
| Screen chunk failure | Safe retry screen | Room and other objects |
| Provider unavailable | Unique safe state | Room and other objects |
| Artwork missing | Typographic fallback | Item title/link |
| Spotify consent declined | External Spotify link | Track metadata |
| Strava frame blocked | Profile link | Move screen |
| Discogs unimplemented | Unavailable crate | Other objects |
| JavaScript unavailable | Object links/pages | Static foundations |

No failure may cause a document reload loop.

## 69. Accessibility acceptance

- Canvas is `aria-hidden` and outside tab order.
- Every room object has a semantic equivalent.
- Scene and semantic activation produce identical public outcomes.
- Object directory order is stable and understandable.
- Spatial keys are documented and conventional where used.
- Visible focus is never hidden by themed chrome.
- Opening moves focus logically.
- Closing restores focus.
- Escape works in every phase.
- Object screens have one visible heading.
- Status updates are concise and not duplicated.
- Search labels match accessible names.
- Provider attribution remains readable.
- Artwork alt behavior remains correct.
- Consent retains its existing accessible dialog/focus behavior.
- No hover-only content.
- 200/400% zoom, text spacing, forced colors, reduced motion, and no JavaScript
  remain complete.
- Axe has no serious or critical findings.
- VoiceOver/Safari and NVDA/Chrome manual checks pass.

## 70. Test architecture

### Unit tests

- Definition schema.
- Permanent unique IDs/slugs.
- Route/object equality.
- Screen-loader key equality.
- Data-source classification.
- Neighbor graph validity.
- Reducer transitions.
- Revision/epoch stale-result rejection.
- Capability decisions.
- Safe failure mapping.

### Structural tests

- Three/R3F imports only under room-3d.
- No screen imports another screen.
- Loader paths are literal.
- No arbitrary dynamic import.
- No provider code in room runtime.
- No Three.js in server, Worker, Home, Work, Sources, or Studio.
- No Web Audio, autoplay, OrbitControls, physics, CSS3DRenderer, or Wasm decoder.
- One room runtime chunk and independent screen chunks.

### Asset tests

- Hashes and attestation.
- Khronos validation.
- Required nodes and parentage.
- Hit/occluder mapping.
- Camera/target anchors.
- Finite/safe transforms.
- Proxy size and budgets.
- Triangle/draw/material/texture budgets.
- External URI denial.
- Custom metadata denial.
- Malformed/malicious GLB fixtures.
- Poster dimensions/hash.

### Interaction tests

- Each modeled object resolves to expected ID.
- Occluder blocks through-selection.
- Pointer down/up same-object requirement.
- Pointer cancel and movement threshold.
- Touch has no hover dependency.
- Scene and directory selection produce identical reducer state, route, screen,
  provider request, scene target, and announcement.
- Rapid selection cancels and resolves correctly.
- Escape and browser Back return.
- Focus restoration.

### Loading tests

- No room before intent.
- No detail asset before object selection.
- No screen chunk/provider/artwork before selection.
- No iframe before consent.
- Stale dynamic import ignored.
- Failed chunk retry.
- Provider abort on unmount.

### Browser tests

- Viewports 320, 390, 768, 1024, 1440, 1920.
- No horizontal overflow.
- No room request on mobile, reduced motion, forced colors, Save-Data, no-JS,
  failed WebGL.
- Room activation and all six selections.
- Camera/object match cuts.
- Direct object routes.
- Refresh on object route.
- Browser Back.
- Context loss.
- Corrupt room/detail asset.
- Repeated enter/exit/resource cleanup.
- 200/400% zoom.
- Text spacing.
- Long multilingual titles.
- Missing artwork.
- Consent and focus restoration.
- Axe and keyboard operation.

### Visual checkpoints

- Room poster.
- 3D overview.
- Hover/focus for each object.
- Approach final frame for each object.
- Unique screen for each object.
- Unavailable/stale/missing-art states.
- Mobile room map.
- Forced-colors layout.
- Reduced-motion object pages.

Use numeric camera/object transforms as authoritative assertions because GPU
pixels can vary.

## 71. Baseline characterization

Before implementation:

- Record current `/play` server HTML.
- Record active-provider request behavior.
- Record current client chunks and CSS.
- Record search/gallery/consent behavior.
- Record keyboard/focus behavior.
- Record no-JavaScript and mobile output.
- Record reduced motion and forced colors.
- Record Lighthouse and Axe.
- Add behavior-level tests before refactoring `PersonalStreams.tsx`.

## 72. Implementation sequence

### A. Add route and object contracts

- Add typed definitions and loader registry.
- Add validated object routes.
- Add unique screen route foundations.
- Preserve existing provider behavior.

### B. Build all six unique 2D screens

- Watch television.
- Read bookshelf.
- Listen pocket player.
- Collect crate unavailable/live contract.
- Play computer.
- Move cardio television.
- Complete mobile, no-JS, forced-colors, zoom, and reduced-motion behavior.

Do not begin 3D until the object screens feel materially distinct.

### C. Build the static room map

- Compose the room poster.
- Add semantic directory/hotspots.
- Validate object recognition.
- Validate Back/deep links/direct routes.

### D. Establish the object platform state machine

- Synchronize route, selected object, focus, and screen.
- Add revision/epoch cancellation.
- Add persistent session UI state where safe.
- Prove inactive providers remain unloaded.

### E. Create the greybox room

- Room shell.
- Watch, Read, and Play objects first.
- Hit proxies and occluders.
- Overview/approach/focus anchors.
- Central raycast controller.
- Demand rendering and disposal.

### F. Prove the three-object interaction

- Pointer selects actual object.
- Directory produces identical outcome.
- Object reacts.
- Camera approaches.
- Unique match cut opens the correct screen.
- Back restores room and focus.
- Test Safari and integrated GPU.

Stop if users cannot identify/open the three objects without instruction.

### G. Establish the asset pipeline

- Original source/provenance.
- Deterministic export.
- Exact node mapping.
- Validation and attestation.
- Content-hashed assets and posters.

### H. Complete all six objects

- Add Listen, Collect, and Move.
- Add detail assets only where they materially improve match cuts.
- Keep each within object budget.

### I. Harden every failure and fallback

- Failed room/detail/screen/provider.
- Context loss.
- Eligibility loss.
- Route changes during transition.
- Document visibility change.
- Rapid selection.
- Resource cleanup.

### J. Compare and review

- Baseline Play.
- Media Rack.
- Bedroom Archive.
- My Room, 2001.

Use identical provider fixtures and tasks.

### K. Release only after explicit selection

- Keep mode server-allowlisted and default-off.
- Run full validation.
- Record bundle/asset/performance evidence.
- Complete assistive-technology and Safari QA.
- Use guarded exact-SHA release flow only after approval.

## 73. User comparison tasks

1. Enter the room.
2. Identify at least four interactive objects without opening the directory.
3. Open the television.
4. Find an anime title.
5. Return to the room.
6. Open the bookshelf using keyboard only.
7. Interpret one reading pattern.
8. Open the pocket player and select rank four.
9. Grant and close Spotify playback consent.
10. Open the computer and find a game.
11. Open Move and use the profile fallback.
12. Use browser Back twice.
13. Explain what each object represents.

Measure:

- Recognition.
- Wrong selections.
- Time to readable screen.
- Back/exit confusion.
- Directory reliance.
- Keyboard errors.
- Motion discomfort.
- Network transfer.
- Whether screens feel genuinely different.
- Whether the room feels personal rather than generic.

Do not add public behavioral analytics for this test.

## 74. Evaluation rubric

Score 1–5:

1. Object discoverability.
2. Room legibility.
3. Direct interaction feel.
4. Transition coherence.
5. Distinctiveness of six screens.
6. Collection usability.
7. Back/exit clarity.
8. Deep-link quality.
9. Keyboard equivalence.
10. Screen-reader equivalence.
11. Mobile/static quality.
12. Reduced-motion quality.
13. Forced-colors/zoom quality.
14. Initial transfer.
15. Object activation transfer.
16. Frame responsiveness.
17. Idle GPU behavior.
18. Failure recovery.
19. Security/privacy preservation.
20. Ease of adding a seventh object.

## 75. Go/no-go before final art

Do not proceed beyond greybox unless:

- Watch, Read, and Play are recognizable without instructions.
- Pointer selection feels like selecting the actual object.
- Semantic directory selection produces exactly the same result.
- Match cuts clearly connect object to unique screen.
- Back and focus restoration are reliable.
- No room or detail asset appears before intent.
- Provider work is active-only.
- Room stops rendering at rest.
- Safari and integrated GPU meet budgets.
- Static/mobile room remains compelling.
- Strict CSP remains unchanged.
- Art is original.

## 76. Go/no-go before production

Do not ship unless:

- All six objects are recognizable and selectable.
- All six screens are materially distinct.
- No generic shared dashboard appears.
- Direct routes and no-JS foundations work.
- Scene and semantic state never diverge.
- Every pointer interaction has a keyboard/screen-reader equivalent.
- Reduced motion/mobile/zoom/forced-colors request no 3D.
- All performance/asset budgets pass.
- Context loss and every failure preserve content.
- Provider privacy, artwork, consent, and attribution tests pass.
- Axe and manual assistive-technology checks pass.
- Adding a fixture seventh object does not require engine changes.
- The full repository validation gate passes.

Immediate no-go if:

- Visitors must hunt for hidden objects.
- Canvas is the only selector.
- Screens are the same layout with different skins.
- Camera motion is required to operate content.
- Mobile is a disabled desktop experience.
- Provider content enters WebGL.
- Room renders continuously behind screens.
- A new object can choose arbitrary code or URLs.
- CSP must be relaxed to meet asset goals.

## 77. Rollout

- Keep baseline available.
- Add `my-room-2001` as a server-allowlisted mode.
- Default it off in production until review.
- Do not combine visual release with connector, D1, KV, OAuth, credential, CSP,
  or Access changes.
- Stage exact validated artifacts.
- Smoke-test anonymous object routes, room entry, protected Studio, connectors,
  consent, security headers, and owner health.
- Record an immutable release attestation.

## 78. Rollback

Rollback is a presentation mode change or prior Worker version.

It must not:

- Restore D1.
- Change KV publication.
- Delete connector snapshots.
- Rotate credentials.
- Change OAuth callbacks.
- Weaken Access.

Cached content-hashed room assets may remain but become unreferenced.

## 79. Maintenance checklist for object changes

- Definition updated.
- Literal loader updated.
- Route updated.
- Unique screen implemented.
- Fallback implemented.
- Data source reviewed.
- Room slot assigned.
- Asset source/provenance updated.
- GLB exported.
- Attestation regenerated.
- Object/direct route tests updated.
- Pointer/keyboard equivalence tested.
- Provider inactivity tested.
- Mobile/zoom/forced-colors/reduced-motion tested.
- Visual checkpoints updated.
- Bundle and asset budgets recorded.
- No unrelated connector or production mutation included.

## 80. Required repository gates

For implementation:

```bash
node .agents/skills/maintain-anish-site/scripts/check-change.mjs --full
npm run validate
npm run validate:browser
```

Run `validate:release` only after the direction is selected, exact source is
clean and pushed, normal release metadata exists, and release is explicitly
approved.

This RFC does not authorize deployment, migration, credential changes, or
production mode activation.

## 81. Open decisions for the greybox

1. Exact room title shown to visitors.
2. Whether first touch reveals then second touch opens.
3. Preferred desktop room threshold between 1100 and 1200px.
4. Whether approach uses one waypoint or a direct cut/dolly.
5. Whether screen routes are indexed or canonicalized under `/play`.
6. Whether Collect appears before the connector is ready.
7. Whether returning retains the last gallery page per object.
8. Which extension slots are authored into the initial room.
9. Maximum visible objects before a second zone/room is required.
10. Whether the reviewed fisheye quality tier passes its performance and edge
    hit-accuracy gates or the normal-perspective tier becomes the default.

Do not create additional experience modes for these decisions. Resolve each
through greybox evidence.

## 82. Primary references

### React and routing

- [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading)
- [React effects](https://react.dev/reference/react/useEffect)
- [MDN History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API)
- [MDN pushState](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState)

### Anime.js

- [Anime.js with React](https://animejs.com/documentation/getting-started/using-with-react/)
- [Anime.js cancel](https://animejs.com/documentation/animation/animation-methods/cancel/)
- [Anime.js update callbacks](https://animejs.com/documentation/animation/animation-callbacks/onupdate/)
- [Anime.js scope cleanup](https://animejs.com/documentation/scope/scope-methods/revert/)

### React Three Fiber and Three.js

- [R3F room reference on CodeSandbox](https://codesandbox.io/p/sandbox/xzlmzz?file=%2Fsrc%2FApp.js)
- [React Three Fiber](https://github.com/pmndrs/react-three-fiber)
- [R3F Canvas](https://r3f.docs.pmnd.rs/api/canvas)
- [R3F on-demand rendering](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [R3F hooks and invalidation](https://r3f.docs.pmnd.rs/api/hooks)
- [R3F pointer events](https://r3f.docs.pmnd.rs/api/events)
- [Drei Fisheye](https://drei.docs.pmnd.rs/portals/fisheye)
- [Drei PresentationControls](https://drei.docs.pmnd.rs/controls/presentation-controls)
- [Drei `useGLTF`](https://drei.docs.pmnd.rs/loaders/gltf-use-gltf)
- [Drei one-frame contact shadows](https://drei.docs.pmnd.rs/staging/contact-shadows)
- [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html)
- [Three.js Object3D](https://threejs.org/docs/pages/Object3D.html)
- [Three.js Vector3 projection](https://threejs.org/docs/pages/Vector3.html)
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Three.js rendering on demand](https://threejs.org/manual/en/rendering-on-demand.html)
- [Three.js responsive rendering](https://threejs.org/manual/en/responsive.html)
- [Three.js object optimization](https://threejs.org/manual/en/optimize-lots-of-objects.html)
- [Three.js disposal](https://threejs.org/manual/en/how-to-dispose-of-objects.html)
- [Three.js CSS3DRenderer limitations](https://threejs.org/docs/pages/CSS3DRenderer.html)

### Assets and browser lifecycle

- [Khronos glTF](https://www.khronos.org/gltf/)
- [Khronos glTF Validator](https://github.khronos.org/glTF-Validator/)
- [Khronos glTF Asset Auditor](https://www.khronos.org/gltf/gltf-asset-auditor/)
- [Blender glTF export](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html)
- [`gltfjsx`](https://github.com/pmndrs/gltfjsx)
- [`gltfpack` and Meshoptimizer](https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md)
- [Blockbench](https://www.blockbench.net/)
- [Blockbench export formats](https://www.blockbench.net/wiki/guides/export-formats/)
- [MDN WebGL context loss](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event)
- [CSP WebAssembly integration](https://www.w3.org/TR/CSP/#wasm-integration)

### Accessibility

- [WAI keyboard interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [WAI Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- [WAI Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WCAG animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)

## 83. Locked visual benchmark — R3F fisheye room

The primary art-and-interaction benchmark is the supplied [R3F fisheye room
CodeSandbox](https://codesandbox.io/p/sandbox/xzlmzz?file=%2Fsrc%2FApp.js).
Treat it as a reference for visual grammar and interaction feel, not as a source
repository or asset pack.

### 83.1 Correct name for the direction

Call the direction:

> A fisheye, low-poly, three-quarter room diorama with bounded presentation
> drag and selectable hero objects.

Do not call it strict isometric rendering in implementation notes. True
isometric projection is orthographic and has no perspective convergence. The
benchmark's appeal comes from a close perspective view, curved miniature-world
distortion, a cutaway shell, and exaggerated prop silhouettes.

### 83.2 What to borrow

- The room reads as one collectible object rather than a full-size environment.
- An open front and curved boundary reveal the complete space immediately.
- A close three-quarter pose gives every hero object a strong silhouette.
- Soft low-poly geometry, rounded edges, and a restrained pastel palette make
  technical hardware feel friendly.
- Large forms sit around deliberate central negative space.
- Drag gently changes the presentation angle without becoming navigation.
- The stage is tactile before an object is selected.
- Interactive objects are visible at the neutral pose and remain visible across
  the complete drag envelope.

### 83.3 What not to copy

The benchmark uses an older demonstration stack and a model named
`level-react-draco.glb`. No reusable license for that room model was established
during this review. Do not copy its source, geometry, textures, exact room
layout, lighting bake, typography, or GLB.

Do not add the benchmark's:

- `VRCanvas`.
- `@react-three/xr`.
- `@lookingglass/webxr`.
- Looking Glass 45-view rendering.
- Old React 17 / R3F 7 dependency graph.
- Remote Draco decoder default.
- Exact orange arcade, cactus, camera, desk, or wall composition.

The XR and Looking Glass packages target holographic/immersive output; they do
not create the object-selection experience and would multiply complexity with
no product benefit. Recreate the feeling with the current first-party stack and
original room art.

### 83.4 Visual art bible

The room shell and all hero props must share:

- Pastel off-white, warm coral, mint, muted violet, CRT charcoal, reading amber,
  and controlled Work blue.
- One shared palette or gradient atlas wherever practical.
- Soft bevels/chamfers on exposed furniture and device edges.
- Flat or lightly graded materials with baked ambient occlusion.
- Original generic hardware silhouettes rather than brand replicas.
- Exaggerated hero controls and object proportions by roughly 5–12% when needed
  for overview readability.
- A curved or chamfered open-front floor/wall silhouette that creates much of
  the miniature feel even when fisheye is unavailable.
- Strong value separation between floor, wall, furniture, and hit objects.
- No photoreal PBR, gritty PSX texture noise, readable brand labels, fake album
  covers, anime characters, or provider artwork.

The six interaction anchors occupy the perimeter and leave a calm center:

```text
rear / wall
┌────────────────────────────────────────────┐
│ Watch TV       Read shelf        Move TV   │
│                                            │
│      Listen dock      central negative     │
│                       space                │
│ Collect crate        Play computer         │
└────────────── open camera edge ────────────┘
front
```

This diagram describes hierarchy, not final coordinates. The final composition
must be authored in Blender and approved from the neutral pose plus all four
view extremes.

## 84. Reference-specific renderer and gesture plan

### 84.1 Three renderer tiers

The same typed room registry and GLB drive three progressively enhanced tiers:

| Tier | Eligibility | Projection | Interaction |
| --- | --- | --- | --- |
| `fisheye` | capable fine-pointer desktop that passes runtime checks | reviewed Drei fisheye | bounded mouse/pen room drag + object selection |
| `wide-perspective` | eligible desktop when fisheye fails or misses budget | 50–58° perspective over curved room shell | same bounded drag + object selection |
| `poster` | mobile, coarse primary pointer, Save-Data, reduced motion, forced colors, 200%+ zoom, failed WebGL, or context loss | first-party still plus semantic HTML | semantic object directory; optional tap regions only if independently verified |

The tier is a rendering choice, not a route or content choice. Object IDs,
provider loading, URLs, focus, status, and screen modules remain identical.
Downgrading never changes available content.

### 84.2 Production component topology

```text
RoomStage
├── semantic RoomObjectDirectory
├── optional VisualRoomAngleControls
└── lazy Canvas (eligible desktop after explicit Enter room)
    └── RoomProjection
        ├── Fisheye or normal PerspectiveCamera
        └── bounded presentation group
            ├── RoomShell
            ├── StaticSetDressing
            ├── HeroObjectRoots
            ├── InteractionProxies
            └── OcclusionProxies
```

`PresentationControls` is the preferred first prototype because it rotates the
contents rather than exposing a general camera and it reproduces the soft
bounded manipulation in the reference. Use the narrow RFC limits rather than
the demo's broad quarter-turn limits. The canvas stage owns its pointer domain;
do not install global page-level drag behavior.

The production contract is the bounded group pose, not a particular control
library. If `PresentationControls` cannot honor deterministic click/drag
arbitration, a small local `RoomPointerRouter` must drive the same group
quaternion. Do not add OrbitControls or loosen the acceptance criteria.

### 84.3 Fisheye cost and fallback

Drei's Fisheye portals the scene through a cubemap and performs six scene
renders per requested frame. Its projection-aware event path is valuable, but
the render multiplier makes the following non-negotiable:

- `frameloop="demand"` and zero requested frames at rest.
- One canvas and one scene.
- 512 cubemap resolution and 32 segments as the first measured profile.
- 384 as the low quality candidate and 640 only as a measured high candidate.
- Fisheye DPR capped at 1.25.
- No continuous idle motion.
- No bloom, SSAO, depth of field, real-time reflection, animated environment
  map, or dynamic shadow cascade.
- Baked AO and lighting; at most one reviewed one-frame grounding shadow.
- Automatic, session-stable fallback to the normal perspective renderer after
  initialization failure, context loss, or a sustained performance miss.

The curved room shell, close framing, soft geometry, and coherent palette must
carry the aesthetic. Fisheye should intensify the look, not rescue weak art.

### 84.4 Drag contract

The neutral pose is the designed composition. Eligible mouse/pen drag changes
only:

- Azimuth offset from −12° to +12°.
- Polar offset from −7° to +7°.

It never changes distance, FOV, target, roll, zoom, page scroll, or route. An
8-CSS-pixel radial dead zone resolves selection jitter. Once a pointer crosses
the dead zone, that gesture can never open an object. Wheel and touch-drag keep
their normal page behavior.

Do not attach required HTML labels to Drei `Html` nodes inside the warped scene;
DOM projection and fisheye distortion can diverge. Use small in-world selection
cues and the persistent semantic directory outside the canvas.

### 84.5 Transition ownership

- Drei or the local room controller owns only bounded overview group motion.
- Anime.js owns the deterministic object acknowledgement, route match cut, and
  semantic screen transition.
- R3F invalidation renders only changed 3D frames.
- Selecting an object disables overview manipulation immediately.
- Object approach starts from the visitor's actual bounded pose and ends at the
  authored focus pose.
- Returning restores the prior overview pose and DOM focus.

Do not add React Spring solely to animate route transitions. Do not make the
room rotate while an object interface is open.

## 85. Asset acquisition strategy

The safest and most coherent plan is a hybrid:

1. Use CC0 kits to block the shell, furniture, and minor clutter.
2. Rework all imported geometry into one palette and silhouette system.
3. Custom-model or commission the six hero interaction anchors.
4. Ship only audited, optimized, first-party-hosted GLBs.

No third-party binary has been added by this RFC. Acquisition belongs in a
focused art branch after the exact source, license snapshot, hash, and intended
use are entered in the asset ledger.

### 85.1 Recommended free or low-cost sources

| Source | License as reviewed | Best use | Decision |
| --- | --- | --- | --- |
| [KayKit Furniture Bits](https://kaylousberg.itch.io/furniture-bits) | CC0; source tier includes editable `.blend` | closest cohesive rounded/pastel base, shared gradient atlas, desk/shelf/room dressing | **Buy the source tier** for editable provenance and palette work; listed around $5.95 at review, verify current price |
| [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) | CC0; [Kenney confirms commercial use](https://kenney.nl/support) | 140-object greybox including bookcases, books, beds, rugs, TVs, radio, desk, speakers | **Download from the official source** as the broad secondary kit |
| [CreativeTrio Household Props 001](https://poly.pizza/bundle/Household-Props-001-KsNBhP96PT) | CC0 | treadmill, computer, monitor, bookshelf, headphones, bed, and filler; includes [treadmill source](https://poly.pizza/m/9hYy4Zmk67) | **Acquire for greybox**, especially the movement corner; normalize in Blender |
| [Hauntedgato LO-FI Computer Desk](https://hauntedgato.itch.io/lo-fi-computer-desk-asset-pack) | CC0; paid pack with Blender/FBX/GLB | CRT, tower, keyboard, mouse, desk, chair, and computer clutter | **Worth buying** as the strongest beige-computer starting point; listed $2.99 at review |
| [Nailfighter CRT TV](https://nailfighter.itch.io/crt-tv-and-remote-models) | CC0 | clean low-poly television and remote | **Acquire if** Kenney's television silhouette is too generic |
| [Quaternius Ultimate Furniture](https://quaternius.com/packs/ultimatefurniture.html) | CC0 | neutral shelf and furniture filler | **Optional**; use only where it reduces custom work without creating style drift |
| [Retro Office Pack](https://retroblockstudio.itch.io/retro-office-pack) | CC0 | 1990s office/TV/computer greybox reference | **Reference or blockout only**; replace its pixel/PSX texture treatment |

CC0 removes the primary copyright redistribution problem, but it does not grant
permission to present trademarks or real brands. Remove all logos and remodel
distinctive trade dress where needed.

### 85.2 Best paid investment

The highest-value spend is one low-poly environment/prop artist, not a large
assortment of visually inconsistent packs. A single artist should deliver:

- The curved open-front room shell.
- Six hero objects with a unified silhouette and material language.
- Exact `OBJ__`, `VIS__`, `HIT__`, `STATE__`, `CAM__`, and `TARGET__` nodes.
- Modular empty extension slots.
- Blender source and exported core/detail GLBs.
- One palette atlas and baked AO/lightmap.
- Neutral and fallback poster renders.
- Geometry, draw-call, texture, and file-size reports.
- Written commercial modification rights and explicit permission to deliver the
  optimized binary publicly through WebGL, acknowledging that client GLBs are
  extractable.
- A warranty that no unlicensed, generative-AI-created, trademarked, or copied
  components are embedded.

The [Polycount paid freelance board](https://polycount.com/categories/freelance-job-postings)
and its [job guidelines](https://polycount.com/discussion/136571/freelance-jobs-guidelines)
are practical sourcing routes. Evaluate applicants through a paid miniature
test: one curved room corner, one original CRT, one hit proxy, one focus anchor,
and one palette atlas.

### 85.3 Conditional paid pack

[Mnostva Low Poly Retro Vintage Rooms](https://www.cgtrader.com/3d-models/interior/house-interior/low-poly-retro-vintage-rooms-interiors)
is a broad 745-asset/20-room fallback containing bedrooms, a game room, a gym,
vinyl hardware, televisions, and computers. It was listed around $59.90 at
review. It is worthwhile only if the seller gives written permission for
commercial public WebGL delivery of modified, extractable GLBs. A marketplace
license that permits incorporation into a project but prohibits standalone
redistribution is ambiguous for browser assets. Do not buy it first and hope the
license fits later.

The ArtStation standard tier for the same pack was view-capped and is unsuitable
for an uncapped public site. An extended tier still does not replace written
WebGL delivery permission.

### 85.4 Explicitly excluded sources

- The CodeSandbox's `level-react-draco.glb`: no reusable asset license found.
- Synty packs without written permission: the reviewed [one-time purchase
  license](https://syntystore.com/pages/one-time-purchase-licence) restricts
  promotional/marketing use connected to generative-AI products or programs,
  which is an unacceptable risk for this AI/ML portfolio.
- Editorial-only, noncommercial, no-derivatives, or unclear custom licenses.
- Photoreal interior/CRT/treadmill packs with 2K–8K textures: wrong art language
  and wrong delivery budget.
- Marketplace assets that prohibit source/binary delivery but do not explicitly
  address public WebGL.
- Any remote hotlinked marketplace preview, model, texture, or decoder.

## 86. Asset provenance and build pipeline

### 86.1 Ledger contract

Every acquired source asset receives a private provenance record and a sanitized
deployable attestation:

```ts
type RoomAssetLedgerEntry = {
  assetId: string;
  sourceUrl: string;
  author: string;
  licenseSpdx: string | null;
  licenseUrl: string;
  acquiredAt: string;
  receiptRef: string | null;
  sourceHash: string;
  modificationNotes: string[];
  outputHash: string;
  attributionText: string | null;
  publicBinaryDeliveryApproved: boolean;
};
```

Receipts, vendor archives, source `.blend`/FBX files, and correspondence remain
private and undeployed. The public attestation contains only approved creator,
license, attribution, and output-hash information. A source cannot enter the
production build when `publicBinaryDeliveryApproved` is false.

### 86.2 Normalization workflow

1. Acquire from the canonical creator/vendor page.
2. Save the exact license text or page snapshot and purchase receipt privately.
3. Hash the untouched source archive.
4. Import into Blender; normalize scale, axes, origins, normals, transforms, and
   material slots.
5. Remove logos, trademarks, unused geometry, hidden faces, metadata, embedded
   cameras, embedded lights, and unapproved animations.
6. Rework shapes and apply the shared room palette/atlas.
7. Add exact named roots, states, hit proxies, occlusion proxies, slots, camera
   anchors, and targets.
8. Bake AO/light where approved.
9. Export glTF 2.0/GLB with Blender's reviewed exporter.
10. Validate with the Khronos validator and asset auditor.
11. Generate typed bindings through an exactly pinned `gltfjsx` workflow while
    preserving the naming contract.
12. Optimize with an exactly pinned, documented `gltfpack`/Meshoptimizer build.
13. Self-host any required decoder/transcoder; never use Drei's remote Draco
    default.
14. Render neutral, four-extreme, selected-object, and fallback checkpoints.
15. Hash the output, update the attestation, and run asset/privacy/bundle gates.

[Blockbench](https://www.blockbench.net/) is acceptable for small custom props
and low-poly iteration; Blender remains the canonical assembly, bake, naming,
and export environment. [Poly Haven](https://polyhaven.com/license) or
[ambientCG](https://ambientcg.com/) CC0 materials may be used only as offline
bake inputs or small, documented supporting textures. The target remains a
compact palette-driven room, not an HDRI/PBR showcase.

### 86.3 Budgets for the fisheye room

- Core room GLB: target at or below 2.5 MB compressed; hard stop 4 MB.
- Initial visible triangles: target at or below 80,000; hard stop 120,000.
- Draw calls: target at or below 60 before fisheye multiplication.
- Core texture GPU allocation: target at or below 48 MB.
- One 1024–2048 palette/light atlas, with a second atlas only after measured
  evidence.
- No provider artwork or live collection data inside any GLB.
- Detail GLBs remain object-specific, lazy, and independently budgeted.
- No decoder, texture, font, or asset request to an unapproved third-party host.

## 87. Reference-specific visual and interaction QA

Capture deterministic checkpoints at:

1. Neutral overview.
2. Maximum left azimuth.
3. Maximum right azimuth.
4. Maximum up polar offset.
5. Maximum down polar offset.
6. Each hero object hovered/focused at neutral.
7. Each hero object selected from neutral.
8. Each hero object selected at the nearest allowed view extreme.
9. Normal-perspective fallback.
10. Static poster/mobile fallback.
11. Context-loss fallback.
12. Forced-colors and 200% zoom semantic views.

Automated and manual tests must prove:

- `0–8px` pointer jitter can select; movement beyond 8px becomes drag.
- A drag starting on an object never opens it.
- Returning to the original object after crossing the threshold still never
  opens it.
- Down/up on different objects opens neither.
- No synthetic click follows a drag.
- Bounds clamp exactly and Reset restores neutral.
- Wheel scrolls the page; touch drag is not trapped.
- All six objects are visible, identifiable, and selectable at neutral and all
  four view extremes.
- Fisheye-corrected selection agrees with the visible object at center, corners,
  distorted edges, and every pose extreme.
- Object approach locks presentation drag; Back restores pose and focus.
- The canvas remains absent from the tab order and accessibility tree.
- Semantic selection and spatial selection produce the same object ID, route,
  provider request, screen, focus destination, and announcement.
- Fisheye and perspective tiers share one registry and no duplicated provider
  logic.
- No 3D code or asset is requested on non-Play routes or in an ineligible tier.
- No renderer, decoder, or imported asset introduces an undeclared network
  origin.

## 88. Reference-specific go/no-go decision

Ship draggable fisheye only when:

- Twenty scripted drags across hero proxies produce zero route openings.
- Twenty object clicks with realistic jitter produce twenty correct openings.
- Every proxy remains accurate at the center, warped edges, and all four room
  pose extremes.
- Active-drag p95 frame time stays below 20 ms on target Safari and Chrome
  laptops and below 33 ms on the minimum eligible device.
- No post-warmup frame exceeds 50 ms in the reviewed interaction sequence.
- At rest, requested frames are zero and renderer resources do not grow.
- The first room input receives visible acknowledgement within one rendered
  frame.
- The normal-perspective fallback remains visually authored and complete.
- The poster and semantic interface remain a designed experience.
- Every shipped mesh has verifiable public-binary-delivery rights.
- The original CodeSandbox GLB, XR packages, Looking Glass packages, remote
  decoder, and unapproved marketplace assets are absent from production.

If fisheye misses performance or hit-accuracy gates, ship the bounded
wide-perspective room. If bounded drag creates selection ambiguity, ship the
fixed clickable room. If WebGL fails, ship the poster and semantic directory.
No fallback changes the six object screens or their content.

## 89. Final recommendation

Build My Room, 2001 as an object platform, not a themed connector shell.

The room overview should be enjoyable to occupy. The television, bookshelf,
pocket player, record crate, computer, and treadmill television should each feel
physical before selection. Selecting one should create a short, coherent
approach and then blossom into a genuinely different interface that belongs to
that object.

The platform underneath should remain strict:

- One selected object.
- One provider at a time.
- One literal screen plug-in at a time.
- One room renderer.
- One safe route per object.
- One equivalent semantic control for every spatial interaction.
- One documented extension path for the next object.

That is the intended fusion: Bedroom Archive supplies the world; Media Rack
supplies six distinct object interfaces; the object transition makes them one
experience.
