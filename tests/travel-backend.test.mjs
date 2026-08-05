import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const {
  publicationSafetyIssue,
  validateTravelPhotoInput,
  validateTravelPhotoMoveInput,
  validateTravelPlaceInput,
  validateTravelTripInput,
  validateTravelTripPatch,
  validateTravelUploadInput,
} = await import("../lib/server/travel/policy.ts");
const {
  parseTravelAtlasSnapshot,
  projectTravelAtlas,
  projectPublicTravelAtlas,
  replaceTravelPublicationTrip,
  projectTravelTripPreview,
  snapshotContainsPhoto,
} = await import("../lib/server/travel/projector.ts");
const {
  parseTravelPreviewScenario,
  previewTravelAtlas,
  TRAVEL_PREVIEW_SCENARIOS,
} = await import("../lib/server/travel/preview.ts");
const travelRepository = await import(
  "../lib/server/travel/repository.ts"
);
const { getPublicTravelAtlas, getPublicTravelTrip } = travelRepository;

test("the Travel repository facade preserves the route-facing operation contract", () => {
  const expectedOperations = [
    "completeTravelMediaDeletion",
    "createTravelPlace",
    "createTravelTrip",
    "createTravelUpload",
    "currentTravelSnapshot",
    "deleteTravelPhoto",
    "deleteTravelPlace",
    "deleteTravelTrip",
    "failTravelUpload",
    "finalizeTravelUpload",
    "findPrivateTravelPhotoStorage",
    "findPublishedTravelMedia",
    "getPublicTravelAtlas",
    "getPublicTravelTrip",
    "getTravelTripDraft",
    "getTravelTripDraftPreview",
    "getTravelUploadForWrite",
    "listTravelTripDrafts",
    "markTravelUploadTemporaryStorage",
    "moveTravelPhoto",
    "patchTravelPhoto",
    "patchTravelPlace",
    "patchTravelTrip",
    "publishTravelTrip",
    "readTravelKvSnapshot",
    "travelPrivateHeaders",
    "travelPublicationVersionKey",
  ];
  for (const operation of expectedOperations) {
    assert.equal(
      typeof travelRepository[operation],
      "function",
      `${operation} must remain exported through the stable facade`,
    );
  }
});

const validTrip = {
  title: "Tokyo after midnight",
  summary: "Arcades, trains, record stores, and street photography.",
  status: "completed",
  period: { start: "2025-10", end: "2025-10", precision: "month" },
};

function withTravelSnapshotHash(snapshot) {
  const withoutHash = {
    schemaVersion: snapshot.schemaVersion,
    publishedAt: snapshot.publishedAt,
    counts: snapshot.counts,
    countries: snapshot.countries,
    trips: snapshot.trips,
  };
  return {
    ...snapshot,
    contentHash: createHash("sha256")
      .update(JSON.stringify(withoutHash))
      .digest("hex"),
  };
}

test("travel trip policy accepts exact plain-text records and rejects structural injection", () => {
  assert.deepEqual(validateTravelTripInput(validTrip), {
    ok: true,
    value: validTrip,
  });
  assert.equal(
    validateTravelTripInput({ ...validTrip, unexpected: true }).ok,
    false,
  );
  const completePlace = {
    label: "New York",
    countryCode: "US",
    countryName: "United States of America",
    admin1Code: "US-NY",
    admin1Name: "New York",
    precision: "region",
    publicPoint: { lat: 43, lng: -75.7 },
    sortOrder: 0,
  };
  for (const field of Object.keys(completePlace)) {
    const incomplete = { ...completePlace };
    delete incomplete[field];
    assert.equal(
      validateTravelPlaceInput(incomplete).ok,
      false,
      `${field} must be required for a complete place`,
    );
  }
  assert.equal(
    validateTravelTripInput({ ...validTrip, summary: "<script>bad()</script>" })
      .ok,
    false,
  );
  assert.equal(
    validateTravelTripInput({
      ...validTrip,
      period: { start: "2025-02-31", end: null, precision: "day" },
    }).ok,
    false,
  );
  assert.equal(validateTravelTripPatch({}).ok, false);
  assert.equal(validateTravelTripPatch({ title: "A revised trip" }).ok, true);
});

test("travel places require complete owner input and canonicalize trusted geography", () => {
  const result = validateTravelPlaceInput({
    label: "New York City",
    countryCode: "us",
    countryName: "Untrusted country name",
    admin1Code: "NY",
    admin1Name: "Untrusted region name",
    precision: "city_approximate",
    publicPoint: { lat: 40.7128, lng: -74.006 },
    sortOrder: 0,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    label: "New York City",
    countryCode: "US",
    countryName: "United States of America",
    admin1Code: "US-NY",
    admin1Name: "New York",
    precision: "city_approximate",
    publicPoint: { lat: 40.7, lng: -74 },
    sortOrder: 0,
  });
  assert.equal(
    validateTravelPlaceInput({
      label: "Bad",
      countryCode: "US",
      countryName: "United States of America",
      admin1Code: null,
      admin1Name: null,
      precision: "city_approximate",
      publicPoint: { lat: 91, lng: 0 },
      sortOrder: 0,
    }).ok,
    false,
  );
  assert.equal(
    validateTravelPlaceInput({
      label: "Incomplete",
      countryCode: "US",
      countryName: "United States of America",
      admin1Code: null,
      admin1Name: null,
      precision: "country",
      publicPoint: { lat: 0, lng: 0 },
    }).ok,
    false,
  );
  assert.deepEqual(
    validateTravelPlaceInput({
      label: "United States",
      countryCode: "US",
      countryName: "Untrusted label",
      admin1Code: null,
      admin1Name: null,
      precision: "country",
      publicPoint: { lat: 0, lng: 0 },
      sortOrder: 1,
    }),
    {
      ok: true,
      value: {
        label: "United States",
        countryCode: "US",
        countryName: "United States of America",
        admin1Code: null,
        admin1Name: null,
        precision: "country",
        publicPoint: { lat: 44.7, lng: -103.6 },
        sortOrder: 1,
      },
    },
  );
  assert.deepEqual(
    validateTravelPlaceInput({
      label: "New York",
      countryCode: "US",
      countryName: "United States",
      admin1Code: "NY",
      admin1Name: "Wrong",
      precision: "region",
      publicPoint: { lat: 0, lng: 0 },
      sortOrder: 2,
    }),
    {
      ok: true,
      value: {
        label: "New York",
        countryCode: "US",
        countryName: "United States of America",
        admin1Code: "US-NY",
        admin1Name: "New York",
        precision: "region",
        publicPoint: { lat: 43, lng: -75.7 },
        sortOrder: 2,
      },
    },
  );
});

test("planned and current publication cannot reveal daily timing, city pins, or photos", () => {
  assert.match(
    publicationSafetyIssue({
      status: "planned",
      period: { start: "2026-08-10", end: null, precision: "day" },
      places: [{ precision: "country" }],
      photoCount: 0,
    }),
    /month- or year-level/i,
  );
  assert.match(
    publicationSafetyIssue({
      status: "current",
      period: { start: "2026-08", end: null, precision: "month" },
      places: [{ precision: "city_approximate" }],
      photoCount: 0,
    }),
    /city/i,
  );
  assert.match(
    publicationSafetyIssue({
      status: "planned",
      period: { start: "2026", end: null, precision: "year" },
      places: [{ precision: "region" }],
      photoCount: 1,
    }),
    /photos/i,
  );
  assert.equal(
    publicationSafetyIssue({
      status: "completed",
      period: { start: "2025-10-02", end: null, precision: "day" },
      places: [{ precision: "city_approximate" }],
      photoCount: 20,
    }),
    null,
  );
});

test("the publication projector rejects unsafe planned/current rows before storage", async () => {
  const unsafeRows = {
    trips: [{
      id: "trip_unsafe_preview",
      slug: "unsafe-preview",
      title: "Unsafe preview",
      summary: "This must not become a publication snapshot.",
      status: "current",
      periodStart: "2026-08",
      periodEnd: null,
      periodPrecision: "month",
      publishedAt: "2026-08-01T00:00:00.000Z",
    }],
    places: [{
      id: "place_unsafe_preview",
      tripId: "trip_unsafe_preview",
      label: "Exact-looking city",
      countryCode: "US",
      countryName: "United States",
      admin1Code: "US-NY",
      admin1Name: "New York",
      precision: "city_approximate",
      publicLat: 40.7,
      publicLng: -74,
      sortOrder: 0,
    }],
    photos: [],
    tags: [],
  };
  await assert.rejects(
    projectTravelAtlas(unsafeRows, "2026-08-01T00:00:00.000Z"),
    /travel_publication_policy_violation/,
  );
});

test("photo and upload validators enforce exact bounded public metadata", () => {
  const photo = {
    placeId: "place_12345678",
    altText: "A train platform under blue station lights.",
    caption: null,
    capturedAt: "2025-10",
    capturePrecision: "month",
    width: 1600,
    height: 1067,
    tags: ["transit", "night"],
    sortOrder: 0,
    isCover: true,
  };
  assert.equal(validateTravelPhotoInput(photo).ok, true);
  assert.equal(
    validateTravelPhotoInput({ ...photo, tags: ["night", "night"] }).ok,
    false,
  );
  assert.equal(
    validateTravelPhotoInput({ ...photo, width: 50000 }).ok,
    false,
  );
  assert.equal(
    validateTravelUploadInput({
      tripId: "trip_12345678",
      mediaType: "image/svg+xml",
      byteSize: 10,
    }).ok,
    false,
  );
  assert.equal(
    validateTravelUploadInput({
      tripId: "trip_12345678",
      mediaType: "image/heic",
      byteSize: 20 * 1024 * 1024,
    }).ok,
    true,
  );
});

test("photo moves use an exact directional contract with a strong photo revision", () => {
  assert.deepEqual(
    validateTravelPhotoMoveInput({
      operation: "move",
      direction: "earlier",
      photoRevision: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }),
    {
      ok: true,
      value: {
        operation: "move",
        direction: "earlier",
        photoRevision: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      },
    },
  );
  assert.equal(
    validateTravelPhotoMoveInput({
      operation: "move",
      direction: "up",
      photoRevision: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }).ok,
    false,
  );
  assert.equal(
    validateTravelPhotoMoveInput({
      operation: "move",
      direction: "later",
      photoRevision: "short",
    }).ok,
    false,
  );
});

test("the exact public projector emits stable counts without storage keys", async () => {
  const rows = {
    trips: [
      {
        id: "trip_12345678",
        slug: "tokyo-12345678",
        title: "Tokyo",
        summary: "A completed trip.",
        status: "completed",
        periodStart: "2025-10",
        periodEnd: null,
        periodPrecision: "month",
        publishedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    places: [
      {
        id: "place_12345678",
        tripId: "trip_12345678",
        label: "Tokyo",
        countryCode: "JP",
        countryName: "Japan",
        admin1Code: null,
        admin1Name: null,
        precision: "city_approximate",
        publicLat: 35.7,
        publicLng: 139.7,
        sortOrder: 0,
      },
    ],
    photos: [
      {
        id: "photo_12345678",
        tripId: "trip_12345678",
        placeId: "place_12345678",
        altText: "A synthetic station scene.",
        caption: null,
        capturedAt: "2025-10",
        capturePrecision: "month",
        width: 1200,
        height: 800,
        sortOrder: 0,
        isCover: 1,
        storageKey: "private/travel/masters/secret.webp",
      },
    ],
    tags: [{ photoId: "photo_12345678", tag: "transit" }],
  };
  const snapshot = await projectTravelAtlas(
    rows,
    "2026-01-02T00:00:00.000Z",
  );
  assert.deepEqual(snapshot.counts, {
    trips: 1,
    countries: 1,
    regions: 0,
    places: 1,
    photos: 1,
  });
  assert.equal(JSON.stringify(snapshot).includes("storageKey"), false);
  assert.equal(JSON.stringify(snapshot).includes("secret.webp"), false);
  const publicAtlas = projectPublicTravelAtlas(snapshot);
  assert.equal(Object.hasOwn(publicAtlas.trips[0], "photos"), false);
  assert.equal(publicAtlas.counts.photos, 1);
  assert.equal(publicAtlas.trips[0].cover.id, "photo_12345678");
  assert.equal(
    snapshotContainsPhoto(
      snapshot,
      "photo_12345678",
      snapshot.trips[0].photos[0].mediaDigest,
    ),
    true,
  );
  assert.deepEqual(await parseTravelAtlasSnapshot(snapshot), snapshot);
  const preview = projectTravelTripPreview(snapshot, "trip_12345678");
  assert.ok(preview);
  assert.equal(preview.contentHash, snapshot.contentHash);
  assert.deepEqual(preview.trip, snapshot.trips[0]);
  assert.deepEqual(
    {
      ...publicAtlas.trips[0],
      photos: snapshot.trips[0].photos,
    },
    preview.trip,
  );
  assert.equal(projectTravelTripPreview(snapshot, "trip_missing"), null);
  assert.equal(
    await parseTravelAtlasSnapshot({ ...snapshot, unexpected: true }),
    null,
  );
  assert.equal(
    await parseTravelAtlasSnapshot({
      ...snapshot,
      trips: [{ ...snapshot.trips[0], title: "Tampered" }],
    }),
    null,
  );
});

test("self-hashed publication snapshots reject cross-trip IDs and inconsistent media facts", async () => {
  const base = await projectTravelAtlas(
    {
      trips: [{
        id: "trip_adversarial_1",
        slug: "adversarial-one",
        title: "Adversarial one",
        summary: "A valid baseline snapshot for trust-boundary tests.",
        status: "completed",
        periodStart: "2025-10",
        periodEnd: null,
        periodPrecision: "month",
        publishedAt: "2026-01-01T00:00:00.000Z",
      }],
      places: [{
        id: "place_adversarial_1",
        tripId: "trip_adversarial_1",
        label: "Tokyo",
        countryCode: "JP",
        countryName: "Japan",
        admin1Code: null,
        admin1Name: null,
        precision: "city_approximate",
        publicLat: 35.7,
        publicLng: 139.7,
        sortOrder: 0,
      }],
      photos: [{
        id: "photo_adversarial_1",
        tripId: "trip_adversarial_1",
        placeId: "place_adversarial_1",
        altText: "A synthetic station scene.",
        caption: null,
        capturedAt: "2025-10",
        capturePrecision: "month",
        width: 1200,
        height: 800,
        sortOrder: 0,
        isCover: 1,
        storageKey: "private/travel/masters/adversarial/source.webp",
      }],
      tags: [],
    },
    "2026-01-02T00:00:00.000Z",
  );

  const duplicateBase = structuredClone(base);
  const duplicateTrip = structuredClone(duplicateBase.trips[0]);
  duplicateTrip.id = "trip_adversarial_2";
  duplicateTrip.slug = "adversarial-two";
  duplicateTrip.title = "Adversarial two";
  duplicateBase.trips.push(duplicateTrip);
  duplicateBase.counts = {
    trips: 2,
    countries: 1,
    regions: 0,
    places: 2,
    photos: 2,
  };
  duplicateBase.countries[0] = {
    ...duplicateBase.countries[0],
    tripCount: 2,
    placeCount: 2,
    photoCount: 2,
  };

  const duplicatePlace = structuredClone(duplicateBase);
  duplicatePlace.trips[1].photos[0].id = "photo_adversarial_2";
  duplicatePlace.trips[1].photos[0].mediaDigest = "b".repeat(64);
  duplicatePlace.trips[1].cover = structuredClone(duplicatePlace.trips[1].photos[0]);
  assert.equal(
    await parseTravelAtlasSnapshot(withTravelSnapshotHash(duplicatePlace)),
    null,
  );

  const duplicatePhoto = structuredClone(duplicateBase);
  duplicatePhoto.trips[1].places[0].id = "place_adversarial_2";
  assert.equal(
    await parseTravelAtlasSnapshot(withTravelSnapshotHash(duplicatePhoto)),
    null,
  );

  const alteredCover = structuredClone(base);
  alteredCover.trips[0].cover = {
    ...alteredCover.trips[0].cover,
    alt: "A forged cover description.",
  };
  assert.equal(
    await parseTravelAtlasSnapshot(withTravelSnapshotHash(alteredCover)),
    null,
  );

  const invalidTripCount = structuredClone(base);
  invalidTripCount.trips[0].places[0].tripCount = 2;
  assert.equal(
    await parseTravelAtlasSnapshot(withTravelSnapshotHash(invalidTripCount)),
    null,
  );

  const invalidAspectRatio = structuredClone(base);
  invalidAspectRatio.trips[0].photos[0].aspectRatio = 1.7;
  invalidAspectRatio.trips[0].cover.aspectRatio = 1.7;
  assert.equal(
    await parseTravelAtlasSnapshot(withTravelSnapshotHash(invalidAspectRatio)),
    null,
  );

  const untrustedCoarsePoint = structuredClone(base);
  untrustedCoarsePoint.trips[0].places[0] = {
    ...untrustedCoarsePoint.trips[0].places[0],
    precision: "country",
    admin1Code: null,
    admin1Name: null,
    publicPoint: { lat: 0, lng: 0 },
  };
  assert.equal(
    await parseTravelAtlasSnapshot(withTravelSnapshotHash(untrustedCoarsePoint)),
    null,
  );
});

test("publication replacement changes only its target trip and preserves multiline copy", async () => {
  const active = await previewTravelAtlas();
  const tokyo = active.trips.find((trip) => trip.id === "trip_preview_tokyo");
  const lisbon = active.trips.find((trip) => trip.id === "trip_preview_lisbon");
  assert.ok(tokyo);
  assert.ok(lisbon);

  const replacement = {
    ...structuredClone(lisbon),
    summary: "A first line.\nA second line with reviewed context.",
  };
  const updated = await replaceTravelPublicationTrip(
    active,
    lisbon.id,
    replacement,
    "2026-02-01T00:00:00.000Z",
  );
  assert.deepEqual(
    updated.trips.find((trip) => trip.id === tokyo.id),
    tokyo,
  );
  assert.equal(
    updated.trips.find((trip) => trip.id === lisbon.id)?.summary,
    replacement.summary,
  );
  assert.equal(active.trips.find((trip) => trip.id === lisbon.id)?.summary, lisbon.summary);
  assert.deepEqual(await parseTravelAtlasSnapshot(updated), updated);

  const unpublished = await replaceTravelPublicationTrip(
    updated,
    lisbon.id,
    null,
    "2026-02-02T00:00:00.000Z",
  );
  assert.deepEqual(unpublished.trips, [tokyo]);
});

test("travel preview scenarios are deterministic, distinct, and publication-safe", async () => {
  assert.deepEqual(TRAVEL_PREVIEW_SCENARIOS, [
    "ready",
    "world",
    "empty",
    "planned",
    "completed",
    "long-caption",
    "missing-media",
  ]);
  assert.equal(parseTravelPreviewScenario(undefined), "ready");
  assert.equal(parseTravelPreviewScenario("completed"), "completed");
  assert.equal(parseTravelPreviewScenario(["long-caption", "empty"]), "long-caption");
  assert.equal(parseTravelPreviewScenario("not-a-fixture"), "ready");

  const ready = await previewTravelAtlas("ready");
  const world = await previewTravelAtlas("world");
  const empty = await previewTravelAtlas("empty");
  const planned = await previewTravelAtlas("planned");
  const completed = await previewTravelAtlas("completed");
  const longCaption = await previewTravelAtlas("long-caption");
  const missingMedia = await previewTravelAtlas("missing-media");

  assert.deepEqual(world, ready);
  assert.equal(empty.counts.trips, 0);
  assert.equal(empty.counts.photos, 0);
  assert.equal(planned.trips.length, 1);
  assert.equal(planned.trips[0].status, "planned");
  assert.equal(planned.trips[0].photos.length, 0);
  assert.deepEqual(completed.trips[0].places[0], {
    id: "place_preview_completed",
    label: "New York City",
    countryCode: "US",
    countryName: "United States of America",
    admin1Code: "US-NY",
    admin1Name: "New York",
    precision: "city_approximate",
    publicPoint: { lat: 40.7, lng: -74 },
    tripCount: 1,
    photoCount: 1,
  });
  assert.ok(longCaption.trips[0].photos[0].caption.length > 300);
  assert.equal(
    missingMedia.trips[0].photos[0].id,
    "photo_preview_intentionally_missing",
  );
  assert.notEqual(empty.contentHash, ready.contentHash);
  assert.notEqual(planned.contentHash, completed.contentHash);

  for (const scenario of TRAVEL_PREVIEW_SCENARIOS) {
    assert.deepEqual(
      await parseTravelAtlasSnapshot(await previewTravelAtlas(scenario)),
      await previewTravelAtlas(scenario),
      `${scenario} must pass the same strict publication schema as real data`,
    );
  }
});

test("travel fixture selection is ignored outside the exact preview boundary", async () => {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  try {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      DEPLOYMENT_TIER: "production",
      SITE_URL: "https://anish-shah-is.online",
      PRODUCTION_SITE_URL: "https://anish-shah-is.online",
      PUBLIC_CONTENT_MODE: "d1_kv_required",
      RELEASE_VERSION: "2.0.0-rc.1",
      TRAVEL_ATLAS_MODE: "atlas-v1",
    };
    const production = await getPublicTravelAtlas(null, null, "completed");
    assert.deepEqual(production, {
      status: "unavailable",
      message: "The travel atlas has not been published yet.",
    });

    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      DEPLOYMENT_TIER: "staging",
      SITE_URL: "https://staging.anish-shah-is.online",
      PRODUCTION_SITE_URL: "https://anish-shah-is.online",
      PUBLIC_CONTENT_MODE: "d1_kv_required",
      RELEASE_VERSION: "2.0.0-rc.1",
      TRAVEL_ATLAS_MODE: "atlas-v1",
    };
    const staging = await getPublicTravelAtlas(null, null, "planned");
    assert.equal(staging.status, "unavailable");
  } finally {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
});

test("exact preview runtime returns deterministic synthetic travel data without durable stores", async () => {
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "26",
    SITE_URL: "https://pr-26.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
    RELEASE_VERSION: "2.0.0-rc.1",
    TRAVEL_ATLAS_MODE: "atlas-v1",
  };
  try {
    const bomb = new Proxy(
      {},
      {
        get() {
          throw new Error("durable preview access");
        },
      },
    );
    const result = await getPublicTravelAtlas(bomb, bomb);
    assert.equal(result.status, "ready");
    assert.equal(result.atlas.counts.trips, 2);
    assert.equal(Object.hasOwn(result.atlas.trips[0], "photos"), false);
    assert.equal(result.atlas.trips.some((trip) => trip.status === "planned"), true);
    const detail = await getPublicTravelTrip(
      "tokyo-after-midnight-preview",
      1,
      12,
      bomb,
      bomb,
    );
    assert.equal(detail.status, "ready");
    assert.equal(detail.trip.photos.length, 2);
    assert.deepEqual(
      projectPublicTravelAtlas(await previewTravelAtlas()),
      result.atlas,
    );
    const completed = await getPublicTravelAtlas(
      bomb,
      bomb,
      "completed",
    );
    assert.equal(completed.status, "ready");
    assert.equal(completed.atlas.counts.trips, 1);
    assert.equal(completed.atlas.countries[0].code, "US");
    const completedTrip = await getPublicTravelTrip(
      "new-york-signal-preview",
      1,
      12,
      bomb,
      bomb,
      "completed",
    );
    assert.equal(completedTrip.status, "ready");
    assert.equal(completedTrip.trip.places[0].admin1Code, "US-NY");
  } finally {
    delete globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  }
});
