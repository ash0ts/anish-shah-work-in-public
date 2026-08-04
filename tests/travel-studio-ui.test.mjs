import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  createTravelPlace,
  getTravelTripPreview,
  moveTravelPhoto,
  publishTravelTrip,
  putTravelUpload,
  unpublishTravelTrip,
} = await import("../app/studio/travel/api.ts");

const ROOT = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

async function travelDeskSource() {
  const modules = [
    "app/studio/travel/TravelDesk.tsx",
    "app/studio/travel/TravelTripPanel.tsx",
    "app/studio/travel/TravelPlacePanel.tsx",
    "app/studio/travel/TravelPhotoIntake.tsx",
    "app/studio/travel/TravelPublicationPreview.tsx",
    "app/studio/travel/travel-desk-model.ts",
  ];
  return (await Promise.all(modules.map(source))).join("\n");
}

test("Travel Desk is independently owner-protected and noindexed", async () => {
  const page = await source("app/studio/travel/page.tsx");
  assert.match(page, /requireChatGPTUser\("\/studio\/travel"\)/);
  assert.match(page, /ownerAuthorizationForEmail\(user\.email\)/);
  assert.match(page, /authorization\.status !== "allowed"/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});

test("Travel Desk uses the canonical owner route namespace and optimistic revisions", async () => {
  const api = await source("app/studio/travel/api.ts");
  const expectedRoutes = [
    "/api/studio/travel/trips",
    "/api/studio/travel/places/",
    "/api/studio/travel/uploads",
    "/api/studio/travel/photos/",
    "/publish",
    "/unpublish",
  ];
  for (const route of expectedRoutes) assert.ok(api.includes(route), route);
  assert.doesNotMatch(api, /\/api\/travel\/.*(?:POST|PATCH|PUT|DELETE)/);
  assert.match(api, /"if-match": quoteRevision\(trip\.revision\)/);
  assert.match(api, /credentials: "same-origin"/);
  assert.match(
    api,
    /body: JSON\.stringify\(\{ confirmWholeTrip: true \}\)/,
  );
});

test("whole-trip publish mutations send the exact confirmation request", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const trip = { id: "trip_request_shape", revision: "revision-12345678" };
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json({ trip });
  };

  try {
    await publishTravelTrip(trip);
    await unpublishTravelTrip(trip);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    requests.map(({ input, init }) => ({
      input,
      method: init.method,
      credentials: init.credentials,
      headers: init.headers,
      body: init.body,
    })),
    ["publish", "unpublish"].map((action) => ({
      input: `/api/studio/travel/trips/${trip.id}/${action}`,
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": `"${trip.revision}"`,
      },
      body: JSON.stringify({ confirmWholeTrip: true }),
    })),
  );
});

test("place creation is revision-protected against the selected trip", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const trip = { id: "trip_revision", revision: "revision-87654321" };
  const draft = {
    label: "New York",
    countryCode: "US",
    countryName: "United States",
    admin1Code: "US-NY",
    admin1Name: "New York",
    precision: "city_approximate",
    publicPoint: { lat: 40.7, lng: -74 },
    sortOrder: 0,
  };
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json({ place: { id: "place_1", ...draft } });
  };

  try {
    await createTravelPlace(trip, draft);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    input: `/api/studio/travel/trips/${trip.id}/places`,
    init: {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": `"${trip.revision}"`,
      },
      body: JSON.stringify(draft),
    },
  });
});

test("exact preview reads and atomic photo moves use the protected owner contract", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const trip = {
    id: "trip_preview_1234",
    revision: "trip-revision-12345678",
  };
  const photo = {
    id: "photo_preview_1234",
    revision: "photo-revision-12345678",
  };
  const preview = {
    schemaVersion: "1.0",
    contentHash: "a".repeat(64),
    projectedAt: "2026-08-04T00:00:00.000Z",
    trip: { id: trip.id },
  };
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ input: String(input), init });
    return String(input).endsWith("/preview")
      ? Response.json({ preview })
      : Response.json({ trip });
  };
  try {
    assert.deepEqual(await getTravelTripPreview(trip.id), preview);
    assert.deepEqual(await moveTravelPhoto(photo, trip, "earlier"), trip);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(requests[0], {
    input: `/api/studio/travel/trips/${trip.id}/preview`,
    init: { cache: "no-store", credentials: "same-origin" },
  });
  assert.deepEqual(requests[1], {
    input: `/api/studio/travel/photos/${photo.id}`,
    init: {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": `"${trip.revision}"`,
      },
      body: JSON.stringify({
        operation: "move",
        direction: "earlier",
        photoRevision: photo.revision,
      }),
    },
  });
});

test("upload bytes carry the transaction trip revision as a strong If-Match", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const transaction = {
    id: "upload_request_1234",
    tripId: "trip_request_1234",
    tripRevision: "trip-revision-12345678",
    uploadUrl: "/api/studio/travel/uploads/upload_request_1234",
    uploadToken: "t".repeat(43),
  };
  globalThis.window = { location: { origin: "https://example.test" } };
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return new Response(null, { status: 204 });
  };
  try {
    await putTravelUpload(
      transaction,
      new Blob([new Uint8Array([1, 2, 3])], {
        type: "image/jpeg",
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.window;
  }
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].input,
    "https://example.test/api/studio/travel/uploads/upload_request_1234",
  );
  assert.deepEqual(requests[0].init.headers, {
    "content-type": "image/jpeg",
    "x-travel-upload-token": transaction.uploadToken,
    "if-match": `"${transaction.tripRevision}"`,
  });
});

test("photo intake keeps filenames and exact EXIF GPS out of requests and React state", async () => {
  const api = await source("app/studio/travel/api.ts");
  const intake = await source("app/studio/travel/photo-intake.ts");
  const desk = await travelDeskSource();
  assert.doesNotMatch(api, /file\.name|filename|originalName/i);
  assert.doesNotMatch(desk, /file\.name|originalName/i);
  assert.doesNotMatch(`${api}\n${intake}\n${desk}`, /console\.(?:log|warn|error)/);
  assert.match(api, /body: file/);
  assert.match(api, /body\.transaction/);
  assert.match(api, /"x-travel-upload-token": upload\.uploadToken/);
  assert.match(intake, /quantizePublicCoordinate\(point\.lat\)/);
  assert.match(intake, /quantizePublicCoordinate\(point\.lng\)/);
  assert.match(desk, /Exact EXIF GPS\s+never enters a public field/);
  assert.match(desk, /immediate metadata stripping/);
});

test("whole-trip publication protects active travel and requires a complete safety review", async () => {
  const desk = await travelDeskSource();
  const contracts = await source("app/studio/travel/contracts.ts");
  assert.match(desk, /Planned\/current trips cannot publish while photos are attached/);
  assert.match(desk, /Remove approximate-city pins from planned\/current travel/);
  assert.match(desk, /Use month- or year-level timing for planned\/current travel/);
  assert.match(desk, /checks\.size !== TRAVEL_SAFETY_CHECKS\.length/);
  assert.match(contracts, /publishing exposes every accepted photo in this trip together/);
  assert.match(desk, /Unpublish this entire trip and every associated photo now/);
});

test("Travel Desk exposes an exact preview, accessible status, and keyboard-sized controls", async () => {
  const desk = await travelDeskSource();
  const css = await source("app/studio/travel/travel.module.css");
  assert.match(desk, /Exact public preview/);
  assert.match(desk, /getTravelTripPreview/);
  assert.match(desk, /<TravelPublicPreview preview=\{publicPreview\}/);
  assert.doesNotMatch(desk, /<TravelPublicPreview trip=\{selectedTrip\}/);
  assert.match(desk, /onMove\("earlier"\)/);
  assert.match(desk, /onMove\("later"\)/);
  assert.doesNotMatch(desk, /sortOrder: photo\.sortOrder [+-] 1/);
  assert.match(desk, /role="status"/);
  assert.match(desk, /tabIndex=\{view === "edit" \? 0 : -1\}/);
  assert.match(desk, /tabIndex=\{view === "preview" \? 0 : -1\}/);
  assert.match(desk, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.doesNotMatch(desk, /statusRef\.current\?\.focus/);
  assert.match(desk, /TRAVEL_BATCH_MAX_FILES = 8/);
  assert.match(
    desk,
    /a batch is limited to \$\{TRAVEL_BATCH_MAX_FILES\}/,
  );
  assert.match(desk, /20 MB each/);
  assert.match(desk, /aria-label="Choose an approximate public point on a world map"/);
  assert.match(desk, /aria-label="Locally staged photos"/);
  assert.match(desk, /aria-label="Stored trip photos"/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /:focus-visible/);
});

test("map suggestions use packaged Natural Earth boundaries and require owner review", async () => {
  const desk = await travelDeskSource();
  const resolver = await source("app/studio/travel/geography-resolver.ts");
  assert.match(resolver, /loadTravelGeographyManifest/);
  assert.match(resolver, /loadTravelAdmin1Manifest/);
  assert.match(resolver, /manifest\.idTexture\.src/);
  assert.match(resolver, /pointInTravelRegion/);
  assert.match(resolver, /cache: "force-cache"/);
  assert.doesNotMatch(
    resolver,
    /(?:googleapis\.com|api\.mapbox\.com|openstreetmap\.org|nominatim\.|fetch\(["']https?:\/\/)/i,
  );
  assert.match(desk, /first-party Natural Earth boundaries/);
  assert.match(desk, /I reviewed this geography suggestion/);
  assert.match(desk, /countryCode: suggestion\.countryCode/);
  assert.match(desk, /admin1Code: suggestion\.admin1Code/);
  assert.match(desk, /event\.detail === 0/);
  assert.match(desk, /latitudeInputRef\.current\?\.focus/);
});

test("the root Studio integration is a small link surface rather than a second editor", async () => {
  const entry = await source("app/studio/travel/TravelDeskEntry.tsx");
  assert.match(entry, /href="\/studio\/travel"/);
  assert.match(entry, /atlasMode === "atlas-v1"/);
  assert.doesNotMatch(entry, /fetch\(/);
});
