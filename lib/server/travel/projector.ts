import type {
  TravelAtlasSnapshot,
  TravelCountrySummary,
  TravelDatePrecision,
  TravelPhotoRef,
  TravelPlacePrecision,
  TravelPlaceSummary,
  TravelProjectedTrip,
  TravelTripPreview,
  TravelTripStatus,
  TravelTripSummary,
} from "@/types/travel";
import {
  TRAVEL_DATE_PRECISIONS,
  TRAVEL_PHOTO_VARIANTS,
  TRAVEL_PLACE_PRECISIONS,
  TRAVEL_TRIP_STATUSES,
} from "@/types/travel";
import { trustedCoarseTravelPlaceIssue } from "./geography-policy";

export type TravelProjectionTripRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: string;
  periodStart: string;
  periodEnd: string | null;
  periodPrecision: string;
  publishedAt: string;
};

export type TravelProjectionPlaceRow = {
  id: string;
  tripId: string;
  label: string;
  countryCode: string;
  countryName: string;
  admin1Code: string | null;
  admin1Name: string | null;
  precision: string;
  publicLat: number;
  publicLng: number;
  sortOrder: number;
};

export type TravelProjectionPhotoRow = {
  id: string;
  tripId: string;
  placeId: string | null;
  altText: string;
  caption: string | null;
  capturedAt: string | null;
  capturePrecision: string | null;
  width: number;
  height: number;
  sortOrder: number;
  isCover: number | boolean;
  storageKey: string;
};

export type TravelProjectionTagRow = {
  photoId: string;
  tag: string;
};

export type TravelProjectionRows = {
  trips: TravelProjectionTripRow[];
  places: TravelProjectionPlaceRow[];
  photos: TravelProjectionPhotoRow[];
  tags: TravelProjectionTagRow[];
};

/**
 * Private publication representation. Photo references live in the active
 * D1/KV snapshot so media authorization and trip pagination do not depend on
 * mutable draft rows. They are deliberately removed from the atlas response.
 */
export type TravelPublishedTrip = TravelProjectedTrip;

export type TravelPublicationSnapshot = Omit<TravelAtlasSnapshot, "trips"> & {
  trips: TravelPublishedTrip[];
};

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copied = new Uint8Array(bytes.length);
  copied.set(bytes);
  return copied.buffer;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        asArrayBuffer(new TextEncoder().encode(value)),
      ),
    ),
  );
}

export async function travelMediaDigest(
  photoId: string,
  storageKey: string,
): Promise<string> {
  return sha256(`travel-media:v1:${photoId}:${storageKey}`);
}

export async function travelMediaStorageKeys(
  photoId: string,
  storageKey: string,
): Promise<string[]> {
  const digest = await travelMediaDigest(photoId, storageKey);
  return [
    storageKey,
    ...TRAVEL_PHOTO_VARIANTS.map(
      (variant) =>
        `private/travel/variants/${photoId}/${digest}/${variant}.webp`,
    ),
  ];
}

async function snapshotHash(
  snapshot: Omit<TravelPublicationSnapshot, "contentHash">,
): Promise<string> {
  return sha256(JSON.stringify(snapshot));
}

function number(value: number): number {
  return Number(value.toFixed(1));
}

function aggregateCountries(
  trips: Array<Pick<TravelTripSummary, "id" | "places">>,
): TravelCountrySummary[] {
  const countryState = new Map<
    string,
    {
      name: string;
      trips: Set<string>;
      regions: Set<string>;
      places: number;
      photos: number;
    }
  >();
  for (const trip of trips) {
    for (const place of trip.places) {
      const current = countryState.get(place.countryCode) ?? {
        name: place.countryName,
        trips: new Set<string>(),
        regions: new Set<string>(),
        places: 0,
        photos: 0,
      };
      if (current.name !== place.countryName) {
        throw new Error("travel_country_name_conflict");
      }
      current.trips.add(trip.id);
      if (place.admin1Code) current.regions.add(place.admin1Code);
      current.places += 1;
      current.photos += place.photoCount;
      countryState.set(place.countryCode, current);
    }
  }
  return [...countryState.entries()]
    .map(([code, value]) => ({
      code,
      name: value.name,
      tripCount: value.trips.size,
      regionCount: value.regions.size,
      placeCount: value.places,
      photoCount: value.photos,
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.code.localeCompare(right.code),
    );
}

function publishedRegionCount(
  trips: Array<Pick<TravelTripSummary, "places">>,
): number {
  return new Set(
    trips.flatMap((trip) =>
      trip.places.flatMap((place) =>
        place.admin1Code ? [`${place.countryCode}:${place.admin1Code}`] : [],
      ),
    ),
  ).size;
}

export async function projectTravelAtlas(
  rows: TravelProjectionRows,
  publishedAt = new Date().toISOString(),
): Promise<TravelPublicationSnapshot> {
  const tags = new Map<string, string[]>();
  for (const row of [...rows.tags].sort(
    (left, right) =>
      left.photoId.localeCompare(right.photoId) || left.tag.localeCompare(right.tag),
  )) {
    const current = tags.get(row.photoId) ?? [];
    if (!current.includes(row.tag)) current.push(row.tag);
    tags.set(row.photoId, current);
  }

  const photosByTrip = new Map<string, TravelPhotoRef[]>();
  const photosByPlace = new Map<string, number>();
  for (const row of [...rows.photos].sort(
    (left, right) =>
      left.tripId.localeCompare(right.tripId) ||
      left.sortOrder - right.sortOrder ||
      left.id.localeCompare(right.id),
  )) {
    const photo: TravelPhotoRef = {
      id: row.id,
      alt: row.altText,
      caption: row.caption,
      capturedAt: row.capturedAt,
      capturePrecision: row.capturePrecision as TravelDatePrecision | null,
      width: row.width,
      height: row.height,
      aspectRatio: Number((row.width / row.height).toFixed(4)),
      mediaDigest: await travelMediaDigest(row.id, row.storageKey),
      tags: tags.get(row.id) ?? [],
    };
    const tripPhotos = photosByTrip.get(row.tripId) ?? [];
    tripPhotos.push(photo);
    photosByTrip.set(row.tripId, tripPhotos);
    if (row.placeId) {
      photosByPlace.set(row.placeId, (photosByPlace.get(row.placeId) ?? 0) + 1);
    }
  }

  const placesByTrip = new Map<string, TravelPlaceSummary[]>();
  for (const row of [...rows.places].sort(
    (left, right) =>
      left.tripId.localeCompare(right.tripId) ||
      left.sortOrder - right.sortOrder ||
      left.id.localeCompare(right.id),
  )) {
    const place: TravelPlaceSummary = {
      id: row.id,
      label: row.label,
      countryCode: row.countryCode,
      countryName: row.countryName,
      admin1Code: row.admin1Code,
      admin1Name: row.admin1Name,
      precision: row.precision as TravelPlacePrecision,
      publicPoint: { lat: number(row.publicLat), lng: number(row.publicLng) },
      tripCount: 1,
      photoCount: photosByPlace.get(row.id) ?? 0,
    };
    const tripPlaces = placesByTrip.get(row.tripId) ?? [];
    tripPlaces.push(place);
    placesByTrip.set(row.tripId, tripPlaces);
  }

  const sourcePhotosById = new Map(rows.photos.map((photo) => [photo.id, photo]));
  const trips: TravelPublishedTrip[] = [...rows.trips]
    .sort(
      (left, right) =>
        right.periodStart.localeCompare(left.periodStart) ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    )
    .map((row) => {
      const photos = photosByTrip.get(row.id) ?? [];
      const cover =
        photos.find((photo) => Boolean(sourcePhotosById.get(photo.id)?.isCover)) ??
        photos[0] ??
        null;
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        status: row.status as TravelTripStatus,
        period: {
          start: row.periodStart,
          end: row.periodEnd,
          precision: row.periodPrecision as TravelDatePrecision,
        },
        places: placesByTrip.get(row.id) ?? [],
        cover,
        photos,
      };
    });

  return composeTravelPublicationSnapshot(trips, publishedAt);
}

export async function composeTravelPublicationSnapshot(
  inputTrips: TravelPublishedTrip[],
  publishedAt = new Date().toISOString(),
): Promise<TravelPublicationSnapshot> {
  const trips = [...inputTrips].sort(
    (left, right) =>
      right.period.start.localeCompare(left.period.start) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
  for (const trip of trips) {
    if (
      trip.photos.length !==
        trip.places.reduce((sum, place) => sum + place.photoCount, 0) ||
      trip.places.some((place) =>
        Boolean(
          trustedCoarseTravelPlaceIssue({
            countryCode: place.countryCode,
            countryName: place.countryName,
            admin1Code: place.admin1Code,
            admin1Name: place.admin1Name,
            precision: place.precision,
            publicPoint: place.publicPoint,
          }),
        ),
      ) ||
      ((trip.status === "planned" || trip.status === "current") &&
        (trip.period.precision === "day" ||
          trip.places.some((place) => place.precision === "city_approximate") ||
          trip.photos.length !== 0 ||
          trip.cover !== null))
    ) {
      throw new Error("travel_publication_policy_violation");
    }
  }

  const countries = aggregateCountries(trips);
  const regionCount = publishedRegionCount(trips);
  const placeCount = trips.reduce((total, trip) => total + trip.places.length, 0);
  const photoCount = trips.reduce((total, trip) => total + trip.photos.length, 0);
  const withoutHash: Omit<TravelPublicationSnapshot, "contentHash"> = {
    schemaVersion: "1.0",
    publishedAt,
    counts: {
      trips: trips.length,
      countries: countries.length,
      regions: regionCount,
      places: placeCount,
      photos: photoCount,
    },
    countries,
    trips,
  };
  const candidate = { ...withoutHash, contentHash: await snapshotHash(withoutHash) };
  const parsed = await parseTravelAtlasSnapshot(candidate);
  if (!parsed) throw new Error("travel_publication_validation_failed");
  return parsed;
}

export async function replaceTravelPublicationTrip(
  active: TravelPublicationSnapshot | null,
  tripId: string,
  replacement: TravelPublishedTrip | null,
  publishedAt = new Date().toISOString(),
): Promise<TravelPublicationSnapshot> {
  return composeTravelPublicationSnapshot(
    [
      ...(active?.trips.filter((trip) => trip.id !== tripId) ?? []),
      ...(replacement ? [replacement] : []),
    ],
    publishedAt,
  );
}

export function projectTravelTripPreview(
  snapshot: TravelPublicationSnapshot,
  tripId: string,
): TravelTripPreview | null {
  const trip = snapshot.trips.find((candidate) => candidate.id === tripId);
  return trip
    ? {
        schemaVersion: "1.0",
        contentHash: snapshot.contentHash,
        projectedAt: snapshot.publishedAt,
        trip,
      }
    : null;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const actual = Object.keys(candidate);
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
    ? candidate
    : null;
}

function iso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function preciseDate(value: unknown, precision: unknown): value is string {
  if (typeof value !== "string") return false;
  if (precision === "year") return /^(?:19|20)\d{2}$/.test(value);
  if (precision === "month") {
    return /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
  }
  return (
    precision === "day" &&
    /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value)
  );
}

function integer(value: unknown, minimum = 0, maximum = 1_000_000): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function text(value: unknown, maximum: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (allowEmpty || value.length > 0) &&
    !/[\u0000-\u0008\u000b\u000c\u000d-\u001f\u007f]/.test(value)
  );
}

function parsePhoto(value: unknown): TravelPhotoRef | null {
  const row = exactRecord(value, [
    "id",
    "alt",
    "caption",
    "capturedAt",
    "capturePrecision",
    "width",
    "height",
    "aspectRatio",
    "mediaDigest",
    "tags",
  ]);
  const expectedAspectRatio =
    typeof row?.width === "number" && typeof row?.height === "number"
      ? row.width / row.height
      : Number.NaN;
  if (
    !row ||
    !text(row.id, 80) ||
    !text(row.alt, 300) ||
    !(row.caption === null || text(row.caption, 600)) ||
    !(row.capturedAt === null || preciseDate(row.capturedAt, row.capturePrecision)) ||
    !(
      row.capturePrecision === null ||
      TRAVEL_DATE_PRECISIONS.includes(row.capturePrecision as TravelDatePrecision)
    ) ||
    ((row.capturedAt === null) !== (row.capturePrecision === null)) ||
    !integer(row.width, 1, 12_000) ||
    !integer(row.height, 1, 12_000) ||
    typeof row.aspectRatio !== "number" ||
    !Number.isFinite(row.aspectRatio) ||
    row.aspectRatio <= 0 ||
    row.aspectRatio > 20 ||
    Math.abs(row.aspectRatio - expectedAspectRatio) > 0.00005 + Number.EPSILON ||
    typeof row.mediaDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.mediaDigest) ||
    !Array.isArray(row.tags) ||
    row.tags.length > 12 ||
    !row.tags.every((tag) => text(tag, 40))
  ) {
    return null;
  }
  return row as unknown as TravelPhotoRef;
}

function samePhoto(left: TravelPhotoRef, right: TravelPhotoRef): boolean {
  return (
    left.id === right.id &&
    left.alt === right.alt &&
    left.caption === right.caption &&
    left.capturedAt === right.capturedAt &&
    left.capturePrecision === right.capturePrecision &&
    left.width === right.width &&
    left.height === right.height &&
    left.aspectRatio === right.aspectRatio &&
    left.mediaDigest === right.mediaDigest &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

function parsePlace(value: unknown): TravelPlaceSummary | null {
  const row = exactRecord(value, [
    "id",
    "label",
    "countryCode",
    "countryName",
    "admin1Code",
    "admin1Name",
    "precision",
    "publicPoint",
    "tripCount",
    "photoCount",
  ]);
  const point = row && exactRecord(row.publicPoint, ["lat", "lng"]);
  const trustedGeographyIssue = row && point
    ? trustedCoarseTravelPlaceIssue({
        countryCode: row.countryCode as string,
        countryName: row.countryName as string,
        admin1Code: row.admin1Code as string | null,
        admin1Name: row.admin1Name as string | null,
        precision: row.precision as TravelPlacePrecision,
        publicPoint: {
          lat: point.lat as number,
          lng: point.lng as number,
        },
      })
    : "invalid";
  if (
    !row ||
    !point ||
    !text(row.id, 80) ||
    !text(row.label, 100) ||
    typeof row.countryCode !== "string" ||
    !/^[A-Z]{2}$/.test(row.countryCode) ||
    !text(row.countryName, 100) ||
    !(row.admin1Code === null || text(row.admin1Code, 16)) ||
    !(row.admin1Name === null || text(row.admin1Name, 100)) ||
    !TRAVEL_PLACE_PRECISIONS.includes(row.precision as TravelPlacePrecision) ||
    typeof point.lat !== "number" ||
    !Number.isFinite(point.lat) ||
    point.lat < -90 ||
    point.lat > 90 ||
    typeof point.lng !== "number" ||
    !Number.isFinite(point.lng) ||
    point.lng < -180 ||
    point.lng > 180 ||
    Math.abs(point.lat * 10 - Math.round(point.lat * 10)) > 1e-8 ||
    Math.abs(point.lng * 10 - Math.round(point.lng * 10)) > 1e-8 ||
    row.tripCount !== 1 ||
    !integer(row.photoCount) ||
    trustedGeographyIssue
  ) {
    return null;
  }
  return row as unknown as TravelPlaceSummary;
}

function parseTrip(value: unknown): TravelPublishedTrip | null {
  const row = exactRecord(value, [
    "id",
    "slug",
    "title",
    "summary",
    "status",
    "period",
    "places",
    "cover",
    "photos",
  ]);
  const period = row && exactRecord(row.period, ["start", "end", "precision"]);
  if (
    !row ||
    !period ||
    !text(row.id, 80) ||
    typeof row.slug !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(row.slug) ||
    !text(row.title, 120) ||
    !text(row.summary, 1_200) ||
    !TRAVEL_TRIP_STATUSES.includes(row.status as TravelTripStatus) ||
    !text(period.start, 10) ||
    !(period.end === null || text(period.end, 10)) ||
    !TRAVEL_DATE_PRECISIONS.includes(period.precision as TravelDatePrecision) ||
    !preciseDate(period.start, period.precision) ||
    !(period.end === null || preciseDate(period.end, period.precision)) ||
    (typeof period.end === "string" && period.end < (period.start as string)) ||
    !Array.isArray(row.places) ||
    row.places.length > 1_000 ||
    !Array.isArray(row.photos) ||
    row.photos.length > 10_000
  ) {
    return null;
  }
  const places = row.places.map(parsePlace);
  const photos = row.photos.map(parsePhoto);
  const cover = row.cover === null ? null : parsePhoto(row.cover);
  if (places.some((place) => !place) || photos.some((photo) => !photo) || (row.cover !== null && !cover)) {
    return null;
  }
  const photoIds = new Set(photos.map((photo) => photo!.id));
  const matchingCover = cover
    ? photos.find((photo) => photo?.id === cover.id) ?? null
    : null;
  if (
    photoIds.size !== photos.length ||
    new Set(places.map((place) => place!.id)).size !== places.length ||
    (cover && (!matchingCover || !samePhoto(cover, matchingCover)))
  ) {
    return null;
  }
  const status = row.status as TravelTripStatus;
  if (
    photos.length !== places.reduce((sum, place) => sum + place!.photoCount, 0) ||
    ((status === "planned" || status === "current") &&
      (period.precision === "day" ||
        places.some((place) => place!.precision === "city_approximate") ||
        photos.length !== 0 ||
        cover !== null))
  ) return null;
  return {
    id: row.id as string,
    slug: row.slug,
    title: row.title as string,
    summary: row.summary as string,
    status,
    period: {
      start: period.start as string,
      end: period.end as string | null,
      precision: period.precision as TravelDatePrecision,
    },
    places: places as TravelPlaceSummary[],
    cover,
    photos: photos as TravelPhotoRef[],
  };
}

export async function parseTravelAtlasSnapshot(
  value: unknown,
): Promise<TravelPublicationSnapshot | null> {
  const row = exactRecord(value, [
    "schemaVersion",
    "contentHash",
    "publishedAt",
    "counts",
    "countries",
    "trips",
  ]);
  const counts = row && exactRecord(row.counts, [
    "trips",
    "countries",
    "regions",
    "places",
    "photos",
  ]);
  if (
    !row ||
    !counts ||
    row.schemaVersion !== "1.0" ||
    typeof row.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.contentHash) ||
    !iso(row.publishedAt) ||
    !Object.values(counts).every((count) => integer(count)) ||
    !Array.isArray(row.countries) ||
    !Array.isArray(row.trips) ||
    row.countries.length > 300 ||
    row.trips.length > 2_000
  ) {
    return null;
  }
  const countries = row.countries.map((value) => {
    const country = exactRecord(value, [
      "code",
      "name",
      "tripCount",
      "regionCount",
      "placeCount",
      "photoCount",
    ]);
    return country &&
      typeof country.code === "string" &&
      /^[A-Z]{2}$/.test(country.code) &&
      text(country.name, 100) &&
      integer(country.tripCount) &&
      integer(country.regionCount) &&
      integer(country.placeCount) &&
      integer(country.photoCount)
      ? (country as unknown as TravelCountrySummary)
      : null;
  });
  const trips = row.trips.map(parseTrip);
  if (countries.some((country) => !country) || trips.some((trip) => !trip)) return null;
  const snapshot: TravelPublicationSnapshot = {
    schemaVersion: "1.0",
    contentHash: row.contentHash,
    publishedAt: row.publishedAt,
    counts: counts as TravelPublicationSnapshot["counts"],
    countries: countries as TravelCountrySummary[],
    trips: trips as TravelPublishedTrip[],
  };
  if (
    snapshot.counts.trips !== snapshot.trips.length ||
    snapshot.counts.countries !== snapshot.countries.length ||
    snapshot.counts.regions !== publishedRegionCount(snapshot.trips) ||
    snapshot.counts.places !== snapshot.trips.reduce((sum, trip) => sum + trip.places.length, 0) ||
    snapshot.counts.photos !== snapshot.trips.reduce((sum, trip) => sum + trip.photos.length, 0) ||
    new Set(snapshot.trips.map((trip) => trip.id)).size !== snapshot.trips.length ||
    new Set(snapshot.trips.map((trip) => trip.slug)).size !== snapshot.trips.length ||
    new Set(snapshot.trips.flatMap((trip) => trip.places.map((place) => place.id)))
      .size !== snapshot.counts.places ||
    new Set(snapshot.trips.flatMap((trip) => trip.photos.map((photo) => photo.id)))
      .size !== snapshot.counts.photos
  ) {
    return null;
  }
  let expectedCountries: TravelCountrySummary[];
  try {
    expectedCountries = aggregateCountries(snapshot.trips);
  } catch {
    return null;
  }
  if (JSON.stringify(expectedCountries) !== JSON.stringify(snapshot.countries)) {
    return null;
  }
  const { contentHash, ...withoutHash } = snapshot;
  return (await snapshotHash(withoutHash)) === contentHash ? snapshot : null;
}

export async function parseTravelAtlasSnapshotJson(
  value: string | null,
): Promise<TravelPublicationSnapshot | null> {
  if (!value || value.length > 16 * 1024 * 1024) return null;
  try {
    return parseTravelAtlasSnapshot(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

export function snapshotContainsPhoto(
  snapshot: TravelPublicationSnapshot,
  photoId: string,
  digest: string,
): boolean {
  return snapshot.trips.some((trip) =>
    trip.photos.some(
      (photo) => photo.id === photoId && photo.mediaDigest === digest,
    ),
  );
}

/** Exact public atlas projection: no gallery payload or private storage data. */
export function projectPublicTravelAtlas(
  snapshot: TravelPublicationSnapshot,
): TravelAtlasSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    contentHash: snapshot.contentHash,
    publishedAt: snapshot.publishedAt,
    counts: { ...snapshot.counts },
    countries: snapshot.countries.map((country) => ({ ...country })),
    trips: snapshot.trips.map((trip) => ({
      id: trip.id,
      slug: trip.slug,
      title: trip.title,
      summary: trip.summary,
      status: trip.status,
      period: { ...trip.period },
      places: trip.places.map((place) => ({
        ...place,
        publicPoint: { ...place.publicPoint },
      })),
      cover: trip.cover
        ? { ...trip.cover, tags: [...trip.cover.tags] }
        : null,
    })),
  };
}
