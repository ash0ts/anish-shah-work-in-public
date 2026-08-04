# Postcard Planet travel atlas

Postcard Planet is the owner-authored Travel object inside My Room 2001. The
semantic atlas and canonical trip pages are the product; the synchronized globe
is a progressive visual instrument. Nothing in the globe is the sole path to a
trip, place, caption, or photo.

## Runtime boundary

`TRAVEL_ATLAS_MODE` is an exact gate:

- `disabled` removes the room object and sitemap entries and makes Travel
  pages and APIs unavailable.
- `atlas-v1` enables the atlas against the current tier's own storage.

Production release generation defaults to `disabled`. Synthetic previews and
live staging use `atlas-v1`. The flag does not publish a trip: public data is
still limited to the active, sanitized Travel publication snapshot.

The `/play` overview performs no Travel read and does not preload geography,
photo data, or atlas JavaScript. `/play/travel` server-renders its full
country/region/trip hierarchy before any optional 3D enhancement. Canonical
trip pages live at `/play/travel/trips/[slug]`.

## Geography

The checked-in geography is deterministic output derived from Natural Earth
5.1.2 public-domain vectors. Run the generator only from the reviewed source
files and exact hashes recorded by the script:

```bash
npm run travel:geography -- --source-dir <directory>
npm run travel:geography:check
```

Generated assets include a 1024×512 country-ID texture, a compact country
manifest, and lazy admin-1 geometry for the bounded set with reliable Natural
Earth coverage. They contain no trips, coordinates, or owner data. The atlas
uses no external tiles, geocoder, photoreal Earth texture, or arbitrary remote
map URL.

Public approximate-city points are explicitly chosen by the owner and quantized
to 0.1 degrees. Exact GPS is never stored. Planned and current trips may publish
only country or region precision, month-level dates, and no photos.

## Authoring and publication

Travel Desk is owner-only and protected by Cloudflare Access, the exact owner
allowlist, same-origin checks, request limits, durable rate limits, and revision
preconditions. Its workflow is:

1. Create a planned, current, or completed trip.
2. Upload candidate photos to a one-time temporary object.
3. Review locally extracted date/GPS suggestions without sending exact GPS to
   the server.
4. Assign reviewed public country, region, or approximate-city places.
5. Add required alt text, optional captions and tags, select a cover, and order
   the accepted photos.
6. Review the exact public projection and publish the whole trip atomically.

There is no per-photo public visibility state. Publishing includes every
accepted photo; unpublishing removes the trip, places, and photos from the
active snapshot immediately.

Writes use `If-Match` revision protection. D1 owns drafts and versioned Travel
snapshots. The existing publication KV receives only the sanitized active
projection and acts as last-known-good state; it never contains upload objects
or private coordinates.

## Media boundary

Each hosted mutable tier has its own private `TRAVEL_MEDIA` R2 bucket and an
`IMAGES` processing binding. PR preview serves a baked, first-party synthetic
placeholder and has no Images, R2, database, Studio, or write capability.
Local, staging, and production media never move automatically between tiers.
Local development uses Cloudflare's low-fidelity offline Images implementation;
staging is the authoritative processing check.

Accepted uploads are JPEG, PNG, WebP, or HEIC, at most 20 MB, with valid
signatures and bounded decoded dimensions. Animated or ambiguous files, SVG,
polyglots, malformed HEIC, and pixel bombs are rejected. Processing applies
orientation, strips metadata, and writes a metadata-free 4096px WebP master.
The temporary raw object is then deleted. Failed and abandoned temporary
objects are removed within 24 hours.

Public media URLs are opaque photo IDs, closed variant names, and snapshot
digests. Before reading or caching a private R2 object, the media endpoint
verifies that the photo and digest are in the current active publication.
Responses carry `X-Robots-Tag: noimageindex`; R2 keys, filenames, provider URLs,
GPS EXIF, and device identifiers are never public contracts.

## Globe and fallback

The atlas globe uses the existing R3F/Three.js boundary with a normal
perspective camera, a three-tone cel surface, Fresnel edge, equal-size pins, and
a visible `0 / 1 / 2 / 3+` trip-count legend. It loads only on the Travel route.
The Canvas is `aria-hidden` and synchronized with real country, region, trip,
place, and photo controls in the DOM.

Drag rotates with an eight-pixel click threshold. Pinch and visible controls
zoom; the ordinary wheel continues to scroll the page. Inertia is short and is
removed with reduced motion. Save-Data, forced colors, high zoom, unavailable
WebGL, or context loss use the complete semantic atlas without requesting or
depending on the globe.

The high-zoom gate takes the larger of `visualViewport.scale` and, for a fine
primary pointer, the conservative `outerWidth / innerWidth` browser-viewport
ratio. The second signal covers desktop page zoom in browsers that leave the
visual viewport scale at `1`; it is deliberately ignored for coarse primary
pointers so mobile browser chrome cannot falsely disable capable-mobile 3D.

## Environment setup

Staging requires a dedicated private R2 bucket and dedicated Travel media
rate-limit namespace:

```text
STAGING_CLOUDFLARE_TRAVEL_MEDIA_BUCKET
STAGING_TRAVEL_MEDIA_RATE_LIMIT_NAMESPACE_ID
```

Production uses the pinned bucket name and rate-limit coordinate in the release
contract. Configuration generation fails when staging and production R2 names
or namespace IDs match. Do not provision, migrate, copy, or delete hosted media
through an ordinary application PR.

Before enabling production, validate the exact SHA on staging with owner-uploaded
test media, review the public snapshot and all breakpoints, then prepare real
production drafts privately while the public gate remains disabled. Activation
is a separate guarded release and owner approval.
