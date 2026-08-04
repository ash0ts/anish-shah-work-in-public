import {
  projectTravelAtlas,
  type TravelProjectionRows,
  type TravelPublicationSnapshot,
} from "./projector";

export const TRAVEL_PREVIEW_SCENARIOS = [
  "ready",
  "world",
  "empty",
  "planned",
  "completed",
  "long-caption",
  "missing-media",
] as const;

export type TravelPreviewScenario =
  (typeof TRAVEL_PREVIEW_SCENARIOS)[number];

const fixturePromises = new Map<
  TravelPreviewScenario,
  Promise<TravelPublicationSnapshot>
>();

const PUBLISHED_AT = "2026-01-15T12:00:00.000Z";

export function parseTravelPreviewScenario(
  value: string | string[] | undefined,
): TravelPreviewScenario {
  const candidate = Array.isArray(value) ? value[0] : value;
  return TRAVEL_PREVIEW_SCENARIOS.includes(candidate as TravelPreviewScenario)
    ? (candidate as TravelPreviewScenario)
    : "ready";
}

function tokyoTrip() {
  return {
    id: "trip_preview_tokyo",
    slug: "tokyo-after-midnight-preview",
    title: "Tokyo after midnight: arcades, record stores, and the last train home",
    summary:
      "A synthetic completed-trip fixture for reviewing Postcard Planet without using personal travel data.",
    status: "completed",
    periodStart: "2025-10",
    periodEnd: "2025-10",
    periodPrecision: "month",
    publishedAt: PUBLISHED_AT,
  };
}

function tokyoPlace() {
  return {
    id: "place_preview_tokyo",
    tripId: "trip_preview_tokyo",
    label: "Tokyo",
    countryCode: "JP",
    countryName: "Japan",
    // The packaged Natural Earth derivative has no reliable Japan admin-1
    // boundary. This synthetic city pin deliberately avoids inventing one.
    admin1Code: null,
    admin1Name: null,
    precision: "city_approximate",
    publicLat: 35.7,
    publicLng: 139.7,
    sortOrder: 0,
  };
}

function lisbonTrip() {
  return {
    id: "trip_preview_lisbon",
    slug: "lisbon-next-preview",
    title: "Lisbon, next",
    summary:
      "A synthetic planned-trip fixture demonstrating broad geography and month-level timing without public photos.",
    status: "planned",
    periodStart: "2026-11",
    periodEnd: null,
    periodPrecision: "month",
    publishedAt: PUBLISHED_AT,
  };
}

function lisbonPlace() {
  return {
    id: "place_preview_lisbon",
    tripId: "trip_preview_lisbon",
    label: "Portugal",
    countryCode: "PT",
    countryName: "Portugal",
    admin1Code: null,
    admin1Name: null,
    precision: "country",
    // The checked-in Natural Earth policy is authoritative for coarse pins,
    // including synthetic previews.
    publicLat: 39.6,
    publicLng: -8.5,
    sortOrder: 0,
  };
}

function newYorkTrip(
  id: string,
  slug: string,
  title: string,
  summary: string,
) {
  return {
    id,
    slug,
    title,
    summary,
    status: "completed",
    periodStart: "2024-05",
    periodEnd: "2024-05",
    periodPrecision: "month",
    publishedAt: PUBLISHED_AT,
  };
}

function newYorkPlace(tripId: string, id: string) {
  return {
    id,
    tripId,
    label: "New York City",
    countryCode: "US",
    countryName: "United States of America",
    admin1Code: "US-NY",
    admin1Name: "New York",
    precision: "city_approximate",
    publicLat: 40.7,
    publicLng: -74,
    sortOrder: 0,
  };
}

function photo(
  id: string,
  tripId: string,
  placeId: string,
  storageKey: string,
  caption: string | null,
) {
  return {
    id,
    tripId,
    placeId,
    altText:
      "Synthetic violet, coral, and blue blocks suggesting a city postcard at dusk.",
    caption,
    capturedAt: "2024-05",
    capturePrecision: "month",
    width: 1200,
    height: 800,
    sortOrder: 0,
    isCover: 1,
    storageKey,
  };
}

function readyRows(): TravelProjectionRows {
  return {
    trips: [tokyoTrip(), lisbonTrip()],
    places: [tokyoPlace(), lisbonPlace()],
    photos: [
      {
        id: "photo_preview_neon",
        tripId: "trip_preview_tokyo",
        placeId: "place_preview_tokyo",
        altText:
          "Synthetic violet and coral blocks suggesting a neon arcade street.",
        caption: "Synthetic preview artwork — no personal photo data.",
        capturedAt: "2025-10",
        capturePrecision: "month",
        width: 1200,
        height: 800,
        sortOrder: 0,
        isCover: 1,
        storageKey: "preview/travel/neon-placeholder.webp",
      },
      {
        id: "photo_preview_train",
        tripId: "trip_preview_tokyo",
        placeId: "place_preview_tokyo",
        altText:
          "Synthetic blue and amber blocks suggesting a late-night train platform.",
        caption: null,
        capturedAt: "2025-10",
        capturePrecision: "month",
        width: 800,
        height: 1200,
        sortOrder: 1,
        isCover: 0,
        storageKey: "preview/travel/train-placeholder.webp",
      },
    ],
    tags: [
      { photoId: "photo_preview_neon", tag: "night" },
      { photoId: "photo_preview_neon", tag: "synthetic" },
      { photoId: "photo_preview_train", tag: "synthetic" },
      { photoId: "photo_preview_train", tag: "transit" },
    ],
  };
}

function completedRows(
  kind: "completed" | "long-caption" | "missing-media",
): TravelProjectionRows {
  const tripId = `trip_preview_${kind.replace("-", "_")}`;
  const placeId = `place_preview_${kind.replace("-", "_")}`;
  const slug =
    kind === "completed"
      ? "new-york-signal-preview"
      : kind === "long-caption"
        ? "long-caption-preview"
        : "missing-media-preview";
  const title =
    kind === "long-caption"
      ? "A postcard with enough context to test the long edge of the contact sheet"
      : kind === "missing-media"
        ? "A postcard whose image transmission was interrupted"
        : "New York in spring: cameras, record bins, and long walks downtown";
  const summary =
    kind === "missing-media"
      ? "A synthetic completed trip whose public image intentionally fails, proving the atlas remains understandable without media."
      : "A synthetic completed-trip signal with reliable country and admin-1 geography for visual review.";
  const photoId =
    kind === "missing-media"
      ? "photo_preview_intentionally_missing"
      : "photo_preview_neon";
  const storageKey =
    kind === "missing-media"
      ? "preview/travel/intentionally-missing.webp"
      : "preview/travel/neon-placeholder.webp";
  const caption =
    kind === "long-caption"
      ? "The light changed while the street kept moving: storefront reflections crossed the bus windows, a stack of records shifted under one arm, and every block offered another small reason to stop. This deliberately long synthetic caption tests how the contact sheet holds narrative context across narrow screens, large type, and awkward line breaks without clipping the photograph, obscuring its metadata, or forcing the page beyond the viewport."
      : "Synthetic preview artwork — no personal photo data.";
  return {
    trips: [newYorkTrip(tripId, slug, title, summary)],
    places: [newYorkPlace(tripId, placeId)],
    photos: [photo(photoId, tripId, placeId, storageKey, caption)],
    tags: [
      { photoId, tag: "city" },
      { photoId, tag: "synthetic" },
    ],
  };
}

function rowsForScenario(scenario: TravelPreviewScenario): TravelProjectionRows {
  if (scenario === "empty") {
    return { trips: [], places: [], photos: [], tags: [] };
  }
  if (scenario === "planned") {
    return {
      trips: [lisbonTrip()],
      places: [lisbonPlace()],
      photos: [],
      tags: [],
    };
  }
  if (
    scenario === "completed" ||
    scenario === "long-caption" ||
    scenario === "missing-media"
  ) {
    return completedRows(scenario);
  }
  // "world" is a visual-review alias for the complete ready fixture. Keeping
  // both labels makes evidence filenames explicit without creating two data
  // contracts that can drift.
  return readyRows();
}

export function previewTravelAtlas(
  scenario: TravelPreviewScenario = "ready",
): Promise<TravelPublicationSnapshot> {
  const cached = fixturePromises.get(scenario);
  if (cached) return cached;
  const fixture = projectTravelAtlas(rowsForScenario(scenario), PUBLISHED_AT);
  fixturePromises.set(scenario, fixture);
  return fixture;
}
