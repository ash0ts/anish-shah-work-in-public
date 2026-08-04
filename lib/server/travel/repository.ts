import type {
  PublicTravelAtlasEnvelope,
  PublicTravelTripEnvelope,
  TravelPhotoDraft,
  TravelPlaceDraft,
  TravelTripPreview,
  TravelTripDetail,
  TravelTripDraft,
  TravelUploadTransaction,
} from "@/types/travel";
import {
  TRAVEL_ACCEPTED_MEDIA_TYPES,
  TRAVEL_UPLOAD_MAX_BYTES,
  normalizeTravelSlug,
  publicationSafetyIssue,
  type TravelPhotoInput,
  type TravelPlaceInput,
  type TravelTripInput,
  type TravelTripPatch,
  type TravelUploadInput,
} from "./policy";
import { normalizeTrustedTravelPlace } from "./geography-policy";
import {
  parseTravelAtlasSnapshotJson,
  projectPublicTravelAtlas,
  projectTravelAtlas,
  projectTravelTripPreview,
  replaceTravelPublicationTrip,
  snapshotContainsPhoto,
  travelMediaStorageKeys,
  type TravelProjectionPhotoRow,
  type TravelProjectionPlaceRow,
  type TravelProjectionRows,
  type TravelProjectionTagRow,
  type TravelProjectionTripRow,
  type TravelPublicationSnapshot,
} from "./projector";
import {
  travelDatabase,
  travelPublicationKv,
  travelPreviewRuntime,
} from "./runtime";
import {
  previewTravelAtlas,
  type TravelPreviewScenario,
} from "./preview";

export const TRAVEL_POINTER_KEY = "travel:current:v1";
export const TRAVEL_VERSION_PREFIX = "travel:version:v1:";
export const TRAVEL_FALLBACK_GATE_KEY = "travel:fallback-gate:v1";
const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

type TripRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: string;
  periodStart: string;
  periodEnd: string | null;
  periodPrecision: string;
  publishedAt: string | null;
  revision: string;
};

type PlaceRow = {
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
  revision: string;
  photoCount?: number;
};

type PhotoRow = {
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
  revision: string;
};

type TagRow = { photoId: string; tag: string };

type SnapshotRow = {
  snapshotId?: string;
  snapshotJson: string;
  contentHash: string;
};

export class TravelRepositoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "TravelRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export type TravelMediaDeletion = {
  id: string;
  storageKeys: string[];
};

function mediaDeletionStatement(
  db: D1Database,
  deletion: TravelMediaDeletion,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO travel_media_deletions (
       id, storage_keys_json, status, attempts, created_at, updated_at
     ) SELECT ?, ?, 'pending', 0, ?, ?
     WHERE changes() = 1`,
  ).bind(deletion.id, JSON.stringify(deletion.storageKeys), now, now);
}

export async function completeTravelMediaDeletion(
  deletionId: string,
  binding: D1Database | null = travelDatabase(),
): Promise<void> {
  const db = database(binding);
  const now = canonicalIso();
  await db.prepare(
    `UPDATE travel_media_deletions
     SET status = 'complete', attempts = attempts + 1,
         last_error_code = NULL, completed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending'`,
  ).bind(now, now, deletionId).run();
}

function database(binding: D1Database | null = travelDatabase()): D1Database {
  if (!binding) {
    throw new TravelRepositoryError(
      "database_unavailable",
      "The travel database is not ready.",
      503,
    );
  }
  return binding;
}

function canonicalIso(): string {
  return new Date().toISOString();
}

export function travelPublicationVersionKey(
  contentHash: string,
  publishedAt: string,
): string {
  const milliseconds = Date.parse(publishedAt);
  if (!/^[a-f0-9]{64}$/.test(contentHash) || !Number.isFinite(milliseconds)) {
    throw new TravelRepositoryError(
      "invalid_publication_key",
      "Travel publication metadata is invalid.",
      500,
    );
  }
  return `${TRAVEL_VERSION_PREFIX}${contentHash}:${milliseconds}`;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function revision(): string {
  return crypto.randomUUID();
}

function mapPlace(row: PlaceRow, photoCount = Number(row.photoCount ?? 0)): TravelPlaceDraft {
  return {
    id: row.id,
    tripId: row.tripId,
    label: row.label,
    countryCode: row.countryCode,
    countryName: row.countryName,
    admin1Code: row.admin1Code,
    admin1Name: row.admin1Name,
    precision: row.precision as TravelPlaceDraft["precision"],
    publicPoint: {
      lat: Number(row.publicLat),
      lng: Number(row.publicLng),
    },
    sortOrder: Number(row.sortOrder),
    photoCount,
    revision: row.revision,
  };
}

function mapPhoto(row: PhotoRow, tags: string[]): TravelPhotoDraft {
  return {
    id: row.id,
    tripId: row.tripId,
    placeId: row.placeId,
    altText: row.altText,
    caption: row.caption,
    capturedAt: row.capturedAt,
    capturePrecision: row.capturePrecision as TravelPhotoDraft["capturePrecision"],
    width: Number(row.width),
    height: Number(row.height),
    tags,
    sortOrder: Number(row.sortOrder),
    isCover: Boolean(row.isCover),
    previewSrc: `/api/studio/travel/photos/${encodeURIComponent(row.id)}/preview`,
    revision: row.revision,
  };
}

async function rowsForTripDrafts(
  binding: D1Database,
  tripId?: string,
): Promise<TravelTripDraft[]> {
  const predicate = tripId ? " WHERE id = ?" : "";
  const tripStatement = binding.prepare(
    `SELECT id, slug, title, summary, status,
            period_start AS periodStart, period_end AS periodEnd,
            period_precision AS periodPrecision,
            published_at AS publishedAt, revision
     FROM travel_trips${predicate}
     ORDER BY period_start DESC, title COLLATE NOCASE ASC, id ASC
     LIMIT 500`,
  );
  const tripsResult = tripId
    ? await tripStatement.bind(tripId).all<TripRow>()
    : await tripStatement.all<TripRow>();
  const trips = tripsResult.results ?? [];
  if (trips.length === 0) return [];

  const [placesResult, photosResult, tagsResult] = await Promise.all([
    binding
      .prepare(
        `SELECT id, trip_id AS tripId, label, country_code AS countryCode,
                country_name AS countryName, admin1_code AS admin1Code,
                admin1_name AS admin1Name, precision,
                public_lat AS publicLat, public_lng AS publicLng,
                sort_order AS sortOrder, revision
         FROM travel_places
         ${tripId ? "WHERE trip_id = ?" : ""}
         ORDER BY trip_id, sort_order, id`,
      )
      .bind(...(tripId ? [tripId] : []))
      .all<PlaceRow>(),
    binding
      .prepare(
        `SELECT id, trip_id AS tripId, place_id AS placeId,
                alt_text AS altText, caption, captured_at AS capturedAt,
                capture_precision AS capturePrecision, width, height,
                sort_order AS sortOrder, is_cover AS isCover,
                storage_key AS storageKey, revision
         FROM travel_photos
         ${tripId ? "WHERE trip_id = ?" : ""}
         ORDER BY trip_id, sort_order, id`,
      )
      .bind(...(tripId ? [tripId] : []))
      .all<PhotoRow>(),
    binding
      .prepare(
        `SELECT tags.photo_id AS photoId, tags.tag
         FROM travel_photo_tags AS tags
         JOIN travel_photos AS photos ON photos.id = tags.photo_id
         ${tripId ? "WHERE photos.trip_id = ?" : ""}
         ORDER BY tags.photo_id, tags.tag`,
      )
      .bind(...(tripId ? [tripId] : []))
      .all<TagRow>(),
  ]);
  const places = placesResult.results ?? [];
  const photos = photosResult.results ?? [];
  const photoCountsByPlace = new Map<string, number>();
  for (const photo of photos) {
    if (photo.placeId) {
      photoCountsByPlace.set(
        photo.placeId,
        (photoCountsByPlace.get(photo.placeId) ?? 0) + 1,
      );
    }
  }
  const tagMap = new Map<string, string[]>();
  for (const tag of tagsResult.results ?? []) {
    const current = tagMap.get(tag.photoId) ?? [];
    current.push(tag.tag);
    tagMap.set(tag.photoId, current);
  }
  return trips.map((trip) => ({
    id: trip.id,
    slug: trip.slug,
    title: trip.title,
    summary: trip.summary,
    status: trip.status as TravelTripDraft["status"],
    period: {
      start: trip.periodStart,
      end: trip.periodEnd,
      precision: trip.periodPrecision as TravelTripDraft["period"]["precision"],
    },
    places: places
      .filter((place) => place.tripId === trip.id)
      .map((place) => mapPlace(place, photoCountsByPlace.get(place.id) ?? 0)),
    photos: photos
      .filter((photo) => photo.tripId === trip.id)
      .map((photo) => mapPhoto(photo, tagMap.get(photo.id) ?? [])),
    publishedAt: trip.publishedAt,
    revision: trip.revision,
  }));
}

async function requireTripDraft(
  binding: D1Database,
  tripId: string,
): Promise<TravelTripDraft> {
  const trip = (await rowsForTripDrafts(binding, tripId))[0];
  if (!trip) {
    throw new TravelRepositoryError("trip_not_found", "Trip not found.", 404);
  }
  return trip;
}

export async function listTravelTripDrafts(
  binding: D1Database | null = travelDatabase(),
): Promise<TravelTripDraft[]> {
  return rowsForTripDrafts(database(binding));
}

export async function getTravelTripDraft(
  tripId: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelTripDraft> {
  return requireTripDraft(database(binding), tripId);
}

export async function createTravelTrip(
  input: TravelTripInput,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelTripDraft> {
  const db = database(binding);
  const tripId = id("trip");
  const now = canonicalIso();
  const nextRevision = revision();
  const slug = normalizeTravelSlug(input.title, tripId);
  await db.batch([
    db.prepare(
      `INSERT INTO travel_trips (
         id, slug, title, summary, status, period_start, period_end,
         period_precision, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      tripId,
      slug,
      input.title,
      input.summary,
      input.status,
      input.period.start,
      input.period.end,
      input.period.precision,
      nextRevision,
      now,
      now,
    ),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       ) VALUES (?, ?, 'travel.trip_created', 'travel_trip', ?, '{}', ?)`,
    ).bind(crypto.randomUUID(), actorEmail, tripId, now),
  ]);
  return requireTripDraft(db, tripId);
}

export async function patchTravelTrip(
  tripId: string,
  input: TravelTripPatch,
  expectedRevision: string,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelTripDraft> {
  const db = database(binding);
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  if (input.title !== undefined) {
    assignments.push("title = ?");
    values.push(input.title);
  }
  if (input.summary !== undefined) {
    assignments.push("summary = ?");
    values.push(input.summary);
  }
  if (input.status !== undefined) {
    assignments.push("status = ?");
    values.push(input.status);
  }
  if (input.period !== undefined) {
    assignments.push("period_start = ?", "period_end = ?", "period_precision = ?");
    values.push(input.period.start, input.period.end, input.period.precision);
  }
  const nextRevision = revision();
  const now = canonicalIso();
  const result = await db.prepare(
    `UPDATE travel_trips
     SET ${assignments.join(", ")}, revision = ?, updated_at = ?
     WHERE id = ? AND revision = ?`,
  ).bind(...values, nextRevision, now, tripId, expectedRevision).run();
  if ((result.meta.changes ?? 0) !== 1) {
    const exists = await db.prepare(`SELECT id FROM travel_trips WHERE id = ? LIMIT 1`).bind(tripId).first();
    throw new TravelRepositoryError(
      exists ? "revision_conflict" : "trip_not_found",
      exists ? "The trip changed after it was loaded." : "Trip not found.",
      exists ? 409 : 404,
    );
  }
  await db.prepare(
    `INSERT INTO audit_log (
       id, actor_email, action, entity_type, entity_id, details_json, created_at
     ) VALUES (?, ?, 'travel.trip_updated', 'travel_trip', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    actorEmail,
    tripId,
    JSON.stringify({ changedFields: Object.keys(input).sort() }),
    now,
  ).run();
  return requireTripDraft(db, tripId);
}

export async function deleteTravelTrip(
  tripId: string,
  expectedRevision: string,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<{
  deletions: TravelMediaDeletion[];
}> {
  const db = database(binding);
  const trip = await requireTripDraft(db, tripId);
  if (trip.revision !== expectedRevision) {
    throw new TravelRepositoryError("revision_conflict", "The trip changed after it was loaded.", 409);
  }
  if (trip.publishedAt) {
    throw new TravelRepositoryError(
      "trip_published",
      "Unpublish the trip before deleting it.",
      409,
    );
  }
  const [photos, uploads] = await Promise.all([
    db.prepare(
      `SELECT id AS photoId, storage_key AS storageKey
       FROM travel_photos
       WHERE trip_id = ?`,
    ).bind(tripId).all<{ photoId: string; storageKey: string }>(),
    db.prepare(
      `SELECT id AS uploadId, storage_key AS storageKey
       FROM travel_uploads
       WHERE trip_id = ? AND storage_key IS NOT NULL AND status != 'consumed'`,
    ).bind(tripId).all<{ uploadId: string; storageKey: string }>(),
  ]);
  const photoDeletions = await Promise.all(
    (photos.results ?? [])
      .filter((row) => row.storageKey.startsWith("private/travel/masters/"))
      .map(async (row) => ({
        id: id("traveldelete"),
        storageKeys: await travelMediaStorageKeys(row.photoId, row.storageKey),
      })),
  );
  const orphanedStorageKeys = [...new Set(
    (uploads.results ?? []).flatMap((row) => {
      const tracked =
        row.storageKey.startsWith("private/travel/masters/") ||
        row.storageKey.startsWith("temporary/travel/")
          ? [row.storageKey]
          : [];
      return [
        ...tracked,
        `private/travel/masters/${row.uploadId}/source.webp`,
      ];
    }),
  )];
  const now = canonicalIso();
  const uploadDeletion = orphanedStorageKeys.length > 0
    ? [{ id: id("traveldelete"), storageKeys: orphanedStorageKeys }]
    : [];
  const deletions = [...photoDeletions, ...uploadDeletion];
  const [deleteResult] = await db.batch([
    db.prepare(`DELETE FROM travel_trips WHERE id = ? AND revision = ?`).bind(tripId, expectedRevision),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       )
       SELECT ?, ?, 'travel.trip_deleted', 'travel_trip', ?, '{}', ?
       WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), actorEmail, tripId, now),
    ...deletions.map((deletion) =>
      mediaDeletionStatement(db, deletion, now)),
  ]);
  if ((deleteResult.meta.changes ?? 0) !== 1) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The trip changed while it was being deleted.",
      409,
    );
  }
  return { deletions };
}

export async function createTravelPlace(
  tripId: string,
  input: TravelPlaceInput,
  expectedTripRevision: string,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelPlaceDraft> {
  const db = database(binding);
  const normalized = normalizeTrustedTravelPlace(input);
  if (!normalized) {
    throw new TravelRepositoryError(
      "invalid_place",
      "The selected geography is not supported by the packaged atlas.",
      400,
    );
  }
  const trip = await requireTripDraft(db, tripId);
  if (trip.revision !== expectedTripRevision) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The trip changed after it was loaded.",
      409,
    );
  }
  const placeId = id("place");
  const now = canonicalIso();
  const nextRevision = revision();
  const nextTripRevision = revision();
  const [tripUpdate, placeInsert] = await db.batch([
    db.prepare(
      `UPDATE travel_trips
       SET revision = ?, updated_at = ?
       WHERE id = ? AND revision = ?`,
    ).bind(nextTripRevision, now, tripId, expectedTripRevision),
    db.prepare(
      `INSERT INTO travel_places (
         id, trip_id, label, country_code, country_name, admin1_code,
         admin1_name, precision, public_lat, public_lng, sort_order,
         revision, created_at, updated_at
       ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      placeId,
      tripId,
      normalized.label,
      normalized.countryCode,
      normalized.countryName,
      normalized.admin1Code,
      normalized.admin1Name,
      normalized.precision,
      normalized.publicPoint.lat,
      normalized.publicPoint.lng,
      normalized.sortOrder,
      nextRevision,
      now,
      now,
      tripId,
      nextTripRevision,
    ),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       ) SELECT ?, ?, 'travel.place_created', 'travel_place', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM travel_places WHERE id = ?)`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      placeId,
      JSON.stringify({ tripId }),
      now,
      placeId,
    ),
  ]);
  if (
    (tripUpdate.meta.changes ?? 0) !== 1 ||
    (placeInsert.meta.changes ?? 0) !== 1
  ) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The trip changed while the place was being added.",
      409,
    );
  }
  return mapPlace({
    id: placeId,
    tripId,
    label: normalized.label,
    countryCode: normalized.countryCode,
    countryName: normalized.countryName,
    admin1Code: normalized.admin1Code,
    admin1Name: normalized.admin1Name,
    precision: normalized.precision,
    publicLat: normalized.publicPoint.lat,
    publicLng: normalized.publicPoint.lng,
    sortOrder: normalized.sortOrder,
    photoCount: 0,
    revision: nextRevision,
  });
}

export async function patchTravelPlace(
  placeId: string,
  input: Partial<TravelPlaceInput>,
  expectedRevision: string,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelPlaceDraft> {
  const db = database(binding);
  const current = await db.prepare(
    `SELECT places.id, places.trip_id AS tripId, places.label,
            places.country_code AS countryCode,
            places.country_name AS countryName,
            places.admin1_code AS admin1Code,
            places.admin1_name AS admin1Name, places.precision,
            places.public_lat AS publicLat, places.public_lng AS publicLng,
            places.sort_order AS sortOrder, places.revision,
            trips.revision AS tripRevision
     FROM travel_places AS places
     JOIN travel_trips AS trips ON trips.id = places.trip_id
     WHERE places.id = ? LIMIT 1`,
  ).bind(placeId).first<PlaceRow & { tripRevision: string }>();
  if (!current) {
    throw new TravelRepositoryError("place_not_found", "Place not found.", 404);
  }
  if (current.revision !== expectedRevision) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The place changed after it was loaded.",
      409,
    );
  }
  const normalized = normalizeTrustedTravelPlace({
    label: input.label ?? current.label,
    countryCode: input.countryCode ?? current.countryCode,
    countryName: input.countryName ?? current.countryName,
    admin1Code:
      input.admin1Code === undefined ? current.admin1Code : input.admin1Code,
    admin1Name:
      input.admin1Name === undefined ? current.admin1Name : input.admin1Name,
    precision: input.precision ?? (current.precision as TravelPlaceInput["precision"]),
    publicPoint: input.publicPoint ?? {
      lat: Number(current.publicLat),
      lng: Number(current.publicLng),
    },
    sortOrder: input.sortOrder ?? Number(current.sortOrder),
  });
  if (!normalized) {
    throw new TravelRepositoryError(
      "invalid_place",
      "The selected geography is not supported by the packaged atlas.",
      400,
    );
  }
  const nextRevision = revision();
  const nextTripRevision = revision();
  const now = canonicalIso();
  const [placeUpdate, tripUpdate] = await db.batch([
    db.prepare(
      `UPDATE travel_places
       SET label = ?, country_code = ?, country_name = ?, admin1_code = ?,
           admin1_name = ?, precision = ?, public_lat = ?, public_lng = ?,
           sort_order = ?, revision = ?, updated_at = ?
       WHERE id = ? AND revision = ?
         AND EXISTS (
           SELECT 1 FROM travel_trips
           WHERE id = ? AND revision = ?
         )`,
    ).bind(
      normalized.label,
      normalized.countryCode,
      normalized.countryName,
      normalized.admin1Code,
      normalized.admin1Name,
      normalized.precision,
      normalized.publicPoint.lat,
      normalized.publicPoint.lng,
      normalized.sortOrder,
      nextRevision,
      now,
      placeId,
      expectedRevision,
      current.tripId,
      current.tripRevision,
    ),
    db.prepare(
      `UPDATE travel_trips
       SET revision = ?, updated_at = ?
       WHERE id = ? AND revision = ?
         AND EXISTS (
           SELECT 1 FROM travel_places WHERE id = ? AND revision = ?
         )`,
    ).bind(
      nextTripRevision,
      now,
      current.tripId,
      current.tripRevision,
      placeId,
      nextRevision,
    ),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       ) SELECT ?, ?, 'travel.place_updated', 'travel_place', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM travel_places WHERE id = ? AND revision = ?
       ) AND EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      placeId,
      JSON.stringify({ changedFields: Object.keys(input).sort() }),
      now,
      placeId,
      nextRevision,
      current.tripId,
      nextTripRevision,
    ),
  ]);
  if (
    (placeUpdate.meta.changes ?? 0) !== 1 ||
    (tripUpdate.meta.changes ?? 0) !== 1
  ) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The place or its trip changed while the update was applied.",
      409,
    );
  }
  const row = await db.prepare(
    `SELECT id, trip_id AS tripId, label, country_code AS countryCode,
            country_name AS countryName, admin1_code AS admin1Code,
            admin1_name AS admin1Name, precision, public_lat AS publicLat,
            public_lng AS publicLng, sort_order AS sortOrder, revision,
            (SELECT COUNT(*) FROM travel_photos WHERE place_id = travel_places.id) AS photoCount
     FROM travel_places WHERE id = ? LIMIT 1`,
  ).bind(placeId).first<PlaceRow>();
  if (!row) throw new TravelRepositoryError("place_not_found", "Place not found.", 404);
  return mapPlace(row);
}

export async function deleteTravelPlace(
  placeId: string,
  expectedRevision: string,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<void> {
  const db = database(binding);
  const current = await db.prepare(
    `SELECT places.trip_id AS tripId, places.revision,
            trips.revision AS tripRevision,
            (SELECT COUNT(*) FROM travel_photos WHERE place_id = places.id) AS photoCount
     FROM travel_places AS places
     JOIN travel_trips AS trips ON trips.id = places.trip_id
     WHERE places.id = ? LIMIT 1`,
  ).bind(placeId).first<{
    tripId: string;
    revision: string;
    tripRevision: string;
    photoCount: number;
  }>();
  if (!current) {
    throw new TravelRepositoryError("place_not_found", "Place not found.", 404);
  }
  if (current.revision !== expectedRevision) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The place changed after it was loaded.",
      409,
    );
  }
  if (Number(current.photoCount) > 0) {
    throw new TravelRepositoryError(
      "place_has_photos",
      "Reassign or remove this place's photos before deleting it.",
      409,
    );
  }
  const now = canonicalIso();
  const nextTripRevision = revision();
  const [placeDelete, tripUpdate] = await db.batch([
    db.prepare(
      `DELETE FROM travel_places
       WHERE id = ? AND revision = ?
         AND NOT EXISTS (SELECT 1 FROM travel_photos WHERE place_id = ?)
         AND EXISTS (
           SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
         )`,
    ).bind(
      placeId,
      expectedRevision,
      placeId,
      current.tripId,
      current.tripRevision,
    ),
    db.prepare(
      `UPDATE travel_trips
       SET revision = ?, updated_at = ?
       WHERE id = ? AND revision = ?
         AND NOT EXISTS (SELECT 1 FROM travel_places WHERE id = ?)`,
    ).bind(
      nextTripRevision,
      now,
      current.tripId,
      current.tripRevision,
      placeId,
    ),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       ) SELECT ?, ?, 'travel.place_deleted', 'travel_place', ?, '{}', ?
       WHERE EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      placeId,
      now,
      current.tripId,
      nextTripRevision,
    ),
  ]);
  if (
    (placeDelete.meta.changes ?? 0) !== 1 ||
    (tripUpdate.meta.changes ?? 0) !== 1
  ) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The place or its trip changed while the deletion was applied.",
      409,
    );
  }
}

function photoAssignments(input: Partial<TravelPhotoInput>): {
  assignments: string[];
  values: Array<string | number | null>;
} {
  const columns: Record<Exclude<keyof TravelPhotoInput, "tags">, string> = {
    placeId: "place_id",
    altText: "alt_text",
    caption: "caption",
    capturedAt: "captured_at",
    capturePrecision: "capture_precision",
    width: "width",
    height: "height",
    sortOrder: "sort_order",
    isCover: "is_cover",
  };
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [field, value] of Object.entries(input) as Array<[keyof TravelPhotoInput, TravelPhotoInput[keyof TravelPhotoInput]]>) {
    if (field === "tags") continue;
    assignments.push(`${columns[field]} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as string | number | null));
  }
  return { assignments, values };
}

export async function patchTravelPhoto(
  photoId: string,
  input: Partial<TravelPhotoInput>,
  expectedRevision: string,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelPhotoDraft> {
  const db = database(binding);
  const current = await db.prepare(
    `SELECT photos.id, photos.trip_id AS tripId, photos.place_id AS placeId,
            photos.alt_text AS altText, photos.caption,
            photos.captured_at AS capturedAt,
            photos.capture_precision AS capturePrecision,
            photos.width, photos.height,
            photos.sort_order AS sortOrder, photos.is_cover AS isCover,
            photos.storage_key AS storageKey, photos.revision,
            trips.revision AS tripRevision
     FROM travel_photos AS photos
     JOIN travel_trips AS trips ON trips.id = photos.trip_id
     WHERE photos.id = ? LIMIT 1`,
  ).bind(photoId).first<PhotoRow & { tripRevision: string }>();
  if (!current) throw new TravelRepositoryError("photo_not_found", "Photo not found.", 404);
  if (current.revision !== expectedRevision) {
    throw new TravelRepositoryError("revision_conflict", "The photo changed after it was loaded.", 409);
  }
  const {
    width: requestedWidth,
    height: requestedHeight,
    ...mutableInput
  } = input;
  if (
    (requestedWidth !== undefined && requestedWidth !== Number(current.width)) ||
    (requestedHeight !== undefined && requestedHeight !== Number(current.height))
  ) {
    throw new TravelRepositoryError(
      "immutable_dimensions",
      "Processed photo dimensions cannot be changed.",
      400,
    );
  }
  if (Object.keys(mutableInput).length === 0) {
    throw new TravelRepositoryError(
      "empty_photo_patch",
      "Provide at least one editable photo field.",
      400,
    );
  }
  if (mutableInput.sortOrder !== undefined) {
    throw new TravelRepositoryError(
      "photo_move_required",
      "Use the atomic photo move operation to change photo order.",
      400,
    );
  }
  if (mutableInput.placeId) {
    const place = await db.prepare(`SELECT trip_id AS tripId FROM travel_places WHERE id = ? LIMIT 1`).bind(mutableInput.placeId).first<{ tripId: string }>();
    if (!place || place.tripId !== current.tripId) {
      throw new TravelRepositoryError("invalid_place", "The selected place does not belong to this trip.", 400);
    }
  }
  const { assignments, values } = photoAssignments(mutableInput);
  const nextRevision = revision();
  const nextTripRevision = revision();
  const siblingRevision = revision();
  const now = canonicalIso();
  const statements: D1PreparedStatement[] = [];
  const updateSql = [
    ...assignments,
    "revision = ?",
    "updated_at = ?",
  ].join(", ");
  statements.push(
    db.prepare(
      `UPDATE travel_photos
       SET ${updateSql}
       WHERE id = ? AND revision = ?
         AND EXISTS (
           SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
         )`,
    ).bind(
      ...values,
      nextRevision,
      now,
      photoId,
      expectedRevision,
      current.tripId,
      current.tripRevision,
    ),
  );
  if (mutableInput.isCover === true) {
    statements.push(
      db.prepare(
        `UPDATE travel_photos
         SET is_cover = 0, revision = ?, updated_at = ?
         WHERE trip_id = ? AND id != ? AND is_cover = 1
           AND EXISTS (
             SELECT 1 FROM travel_photos WHERE id = ? AND revision = ?
           )`,
      ).bind(
        siblingRevision,
        now,
        current.tripId,
        photoId,
        photoId,
        nextRevision,
      ),
    );
  }
  if (mutableInput.tags) {
    statements.push(
      db.prepare(
        `DELETE FROM travel_photo_tags
         WHERE photo_id = ?
           AND EXISTS (
             SELECT 1 FROM travel_photos WHERE id = ? AND revision = ?
           )`,
      ).bind(photoId, photoId, nextRevision),
    );
    for (const tag of mutableInput.tags) {
      statements.push(
        db.prepare(
          `INSERT INTO travel_photo_tags (photo_id, tag)
           SELECT ?, ? WHERE EXISTS (
             SELECT 1 FROM travel_photos WHERE id = ? AND revision = ?
           )`,
        ).bind(photoId, tag, photoId, nextRevision),
      );
    }
  }
  const tripUpdateIndex = statements.length;
  statements.push(
    db.prepare(
      `UPDATE travel_trips
       SET revision = ?, updated_at = ?
       WHERE id = ? AND revision = ?
         AND EXISTS (
           SELECT 1 FROM travel_photos WHERE id = ? AND revision = ?
         )`,
    ).bind(
      nextTripRevision,
      now,
      current.tripId,
      current.tripRevision,
      photoId,
      nextRevision,
    ),
  );
  statements.push(
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       ) SELECT ?, ?, 'travel.photo_updated', 'travel_photo', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM travel_photos WHERE id = ? AND revision = ?
       ) AND EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      photoId,
      JSON.stringify({ changedFields: Object.keys(mutableInput).sort() }),
      now,
      photoId,
      nextRevision,
      current.tripId,
      nextTripRevision,
    ),
  );
  const results = await db.batch(statements);
  if (
    (results[0]?.meta.changes ?? 0) !== 1 ||
    (results[tripUpdateIndex]?.meta.changes ?? 0) !== 1
  ) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The photo or its trip changed while the update was applied.",
      409,
    );
  }
  const updated = await db.prepare(
    `SELECT id, trip_id AS tripId, place_id AS placeId,
            alt_text AS altText, caption, captured_at AS capturedAt,
            capture_precision AS capturePrecision, width, height,
            sort_order AS sortOrder, is_cover AS isCover,
            storage_key AS storageKey, revision
     FROM travel_photos WHERE id = ? AND revision = ? LIMIT 1`,
  ).bind(photoId, nextRevision).first<PhotoRow>();
  if (!updated) throw new TravelRepositoryError("photo_not_found", "Photo not found.", 404);
  const tagsResult = await db.prepare(`SELECT tag FROM travel_photo_tags WHERE photo_id = ? ORDER BY tag`).bind(photoId).all<{ tag: string }>();
  return mapPhoto(updated, (tagsResult.results ?? []).map((row) => row.tag));
}

export async function moveTravelPhoto(
  photoId: string,
  direction: "earlier" | "later",
  expectedPhotoRevision: string,
  expectedTripRevision: string,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelTripDraft> {
  const db = database(binding);
  const ordered = await db.prepare(
    `SELECT photos.id, photos.trip_id AS tripId,
            photos.sort_order AS sortOrder, photos.revision,
            trips.revision AS tripRevision
     FROM travel_photos AS photos
     JOIN travel_trips AS trips ON trips.id = photos.trip_id
     WHERE photos.trip_id = (
       SELECT trip_id FROM travel_photos WHERE id = ? LIMIT 1
     )
     ORDER BY photos.sort_order, photos.id`,
  ).bind(photoId).all<{
    id: string;
    tripId: string;
    sortOrder: number;
    revision: string;
    tripRevision: string;
  }>();
  const rows = ordered.results ?? [];
  const currentIndex = rows.findIndex((row) => row.id === photoId);
  if (currentIndex < 0) {
    throw new TravelRepositoryError("photo_not_found", "Photo not found.", 404);
  }
  const current = rows[currentIndex];
  if (
    current.revision !== expectedPhotoRevision ||
    current.tripRevision !== expectedTripRevision
  ) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The photo or its trip changed after it was loaded.",
      409,
    );
  }
  const delta = direction === "earlier" ? -1 : 1;
  const nextIndex = currentIndex + delta;
  if (nextIndex < 0 || nextIndex >= rows.length) {
    throw new TravelRepositoryError(
      "photo_move_boundary",
      "The photo is already at that edge of the trip.",
      409,
    );
  }

  const now = canonicalIso();
  const nextTripRevision = revision();
  const photoCount = rows.length;
  const [photoUpdate, tripUpdate] = await db.batch([
    db.prepare(
      `WITH ordered AS (
         SELECT id,
                row_number() OVER (ORDER BY sort_order, id) - 1 AS current_order
         FROM travel_photos
         WHERE trip_id = ?
       ), target AS (
         SELECT current_order FROM ordered WHERE id = ?
       ), moved AS (
         SELECT ordered.id,
                CASE
                  WHEN ordered.id = ? THEN target.current_order + ?
                  WHEN ordered.current_order = target.current_order + ?
                    THEN target.current_order
                  ELSE ordered.current_order
                END AS next_order
         FROM ordered CROSS JOIN target
       )
       UPDATE travel_photos
       SET sort_order = (
             SELECT moved.next_order FROM moved
             WHERE moved.id = travel_photos.id
           ),
           revision = lower(hex(randomblob(16))),
           updated_at = ?
       WHERE trip_id = ?
         AND EXISTS (SELECT 1 FROM target)
         AND EXISTS (
           SELECT 1 FROM travel_trips
           WHERE id = ? AND revision = ?
         )
         AND EXISTS (
           SELECT 1 FROM travel_photos
           WHERE id = ? AND revision = ? AND trip_id = ?
         )`,
    ).bind(
      current.tripId,
      photoId,
      photoId,
      delta,
      delta,
      now,
      current.tripId,
      current.tripId,
      expectedTripRevision,
      photoId,
      expectedPhotoRevision,
      current.tripId,
    ),
    db.prepare(
      `UPDATE travel_trips
       SET revision = ?, updated_at = ?
       WHERE id = ? AND revision = ? AND changes() = ?`,
    ).bind(
      nextTripRevision,
      now,
      current.tripId,
      expectedTripRevision,
      photoCount,
    ),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       ) SELECT ?, ?, 'travel.photo_moved', 'travel_photo', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      photoId,
      JSON.stringify({ direction }),
      now,
      current.tripId,
      nextTripRevision,
    ),
  ]);
  if (
    (photoUpdate.meta.changes ?? 0) !== photoCount ||
    (tripUpdate.meta.changes ?? 0) !== 1
  ) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The photo order changed while the move was applied.",
      409,
    );
  }
  return requireTripDraft(db, current.tripId);
}

export async function deleteTravelPhoto(
  photoId: string,
  expectedRevision: string,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<{ deletion: TravelMediaDeletion }> {
  const db = database(binding);
  const row = await db.prepare(
    `SELECT photos.trip_id AS tripId, photos.storage_key AS storageKey,
            photos.revision, trips.published_at AS publishedAt,
            trips.revision AS tripRevision
     FROM travel_photos AS photos
     JOIN travel_trips AS trips ON trips.id = photos.trip_id
     WHERE photos.id = ? LIMIT 1`,
  ).bind(photoId).first<{
    tripId: string;
    storageKey: string;
    revision: string;
    publishedAt: string | null;
    tripRevision: string;
  }>();
  if (!row) throw new TravelRepositoryError("photo_not_found", "Photo not found.", 404);
  if (row.revision !== expectedRevision) {
    throw new TravelRepositoryError("revision_conflict", "The photo changed after it was loaded.", 409);
  }
  if (row.publishedAt) {
    throw new TravelRepositoryError("trip_published", "Unpublish the trip before deleting a photo.", 409);
  }
  const deletion: TravelMediaDeletion = {
    id: id("traveldelete"),
    storageKeys: await travelMediaStorageKeys(photoId, row.storageKey),
  };
  const now = canonicalIso();
  const nextTripRevision = revision();
  const [deleteResult, tripUpdate] = await db.batch([
    db.prepare(
      `DELETE FROM travel_photos
       WHERE id = ? AND revision = ?
         AND EXISTS (
           SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
         )`,
    ).bind(photoId, expectedRevision, row.tripId, row.tripRevision),
    db.prepare(
      `UPDATE travel_trips
       SET revision = ?, updated_at = ?
       WHERE id = ? AND revision = ?
         AND NOT EXISTS (SELECT 1 FROM travel_photos WHERE id = ?)`,
    ).bind(nextTripRevision, now, row.tripId, row.tripRevision, photoId),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       ) SELECT ?, ?, 'travel.photo_deleted', 'travel_photo', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      photoId,
      JSON.stringify({ tripId: row.tripId }),
      now,
      row.tripId,
      nextTripRevision,
    ),
    mediaDeletionStatement(db, deletion, now),
  ]);
  if (
    (deleteResult.meta.changes ?? 0) !== 1 ||
    (tripUpdate.meta.changes ?? 0) !== 1
  ) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The photo changed while it was being deleted.",
      409,
    );
  }
  return { deletion };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createTravelUpload(
  input: TravelUploadInput,
  expectedTripRevision: string,
  actorEmail: string,
  requestOrigin: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelUploadTransaction> {
  const db = database(binding);
  const trip = await requireTripDraft(db, input.tripId);
  if (trip.revision !== expectedTripRevision) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The trip changed after it was loaded.",
      409,
    );
  }
  const uploadId = id("upload");
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = canonicalIso();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const [insertResult] = await db.batch([
    db.prepare(
      `INSERT INTO travel_uploads (
         id, trip_id, token_hash, status, media_type, declared_bytes,
         expires_at, created_at, updated_at
       ) SELECT ?, ?, ?, 'issued', ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      uploadId,
      input.tripId,
      await tokenHash(token),
      input.mediaType,
      input.byteSize,
      expiresAt,
      now,
      now,
      input.tripId,
      expectedTripRevision,
    ),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       ) SELECT ?, ?, 'travel.upload_issued', 'travel_upload', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM travel_uploads WHERE id = ?)`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      uploadId,
      JSON.stringify({ tripId: input.tripId }),
      now,
      uploadId,
    ),
  ]);
  if ((insertResult.meta.changes ?? 0) !== 1) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The trip changed while the upload transaction was created.",
      409,
    );
  }
  return {
    id: uploadId,
    tripId: input.tripId,
    tripRevision: expectedTripRevision,
    uploadUrl: `${requestOrigin}/api/studio/travel/uploads/${encodeURIComponent(uploadId)}`,
    uploadToken: token,
    expiresAt,
    maxBytes: TRAVEL_UPLOAD_MAX_BYTES,
    acceptedMediaTypes: TRAVEL_ACCEPTED_MEDIA_TYPES,
  };
}

export type TravelUploadRow = {
  id: string;
  tripId: string;
  tripRevision: string;
  tokenHash: string;
  status: string;
  mediaType: string;
  declaredBytes: number;
  storedBytes: number | null;
  processedWidth: number | null;
  processedHeight: number | null;
  storageKey: string | null;
  expiresAt: string;
};

export async function getTravelUploadForWrite(
  uploadId: string,
  token: string,
  expectedTripRevision: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelUploadRow> {
  const db = database(binding);
  const row = await db.prepare(
    `SELECT uploads.id, uploads.trip_id AS tripId,
            trips.revision AS tripRevision,
            uploads.token_hash AS tokenHash, uploads.status,
            uploads.media_type AS mediaType,
            uploads.declared_bytes AS declaredBytes,
            uploads.stored_bytes AS storedBytes,
            uploads.processed_width AS processedWidth,
            uploads.processed_height AS processedHeight,
            uploads.storage_key AS storageKey,
            uploads.expires_at AS expiresAt
     FROM travel_uploads AS uploads
     JOIN travel_trips AS trips ON trips.id = uploads.trip_id
     WHERE uploads.id = ? LIMIT 1`,
  ).bind(uploadId).first<TravelUploadRow>();
  if (!row || row.tokenHash !== (await tokenHash(token))) {
    throw new TravelRepositoryError("upload_not_found", "Upload transaction not found.", 404);
  }
  if (row.tripRevision !== expectedTripRevision) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The trip changed after the upload transaction was created.",
      409,
    );
  }
  if (Date.parse(row.expiresAt) <= Date.now()) {
    throw new TravelRepositoryError("upload_expired", "Upload transaction expired.", 410);
  }
  if (row.status !== "issued") {
    throw new TravelRepositoryError("upload_consumed", "Upload transaction has already been used.", 409);
  }
  return row;
}

export async function completeTravelUploadStorage(
  uploadId: string,
  expectedStatus: "issued",
  storageKey: string,
  storedBytes: number,
  processedWidth: number,
  processedHeight: number,
  actorEmail: string,
  tripId: string,
  expectedTripRevision: string,
  binding: D1Database | null = travelDatabase(),
): Promise<void> {
  const db = database(binding);
  const now = canonicalIso();
  const result = await db.prepare(
    `UPDATE travel_uploads
     SET status = 'uploaded', storage_key = ?, stored_bytes = ?,
         processed_width = ?, processed_height = ?, updated_at = ?
     WHERE id = ? AND status = ? AND expires_at > ?
       AND trip_id = ?
       AND EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
  ).bind(
    storageKey,
    storedBytes,
    processedWidth,
    processedHeight,
    now,
    uploadId,
    expectedStatus,
    now,
    tripId,
    tripId,
    expectedTripRevision,
  ).run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new TravelRepositoryError("upload_conflict", "Upload transaction could not be completed.", 409);
  }
  await db.prepare(
    `INSERT INTO audit_log (
       id, actor_email, action, entity_type, entity_id, details_json, created_at
     ) VALUES (?, ?, 'travel.upload_stored', 'travel_upload', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      uploadId,
      JSON.stringify({ storedBytes, processedWidth, processedHeight }),
      now,
    ).run();
}

export async function markTravelUploadTemporaryStorage(
  uploadId: string,
  rawKey: string,
  tripId: string,
  expectedTripRevision: string,
  binding: D1Database | null = travelDatabase(),
): Promise<void> {
  if (!rawKey.startsWith("temporary/travel/")) {
    throw new TravelRepositoryError("invalid_storage_key", "Invalid temporary image key.", 400);
  }
  const db = database(binding);
  const now = canonicalIso();
  const result = await db.prepare(
    `UPDATE travel_uploads
     SET storage_key = ?, updated_at = ?
     WHERE id = ? AND status = 'issued' AND storage_key IS NULL AND expires_at > ?
       AND trip_id = ?
       AND EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
  ).bind(
    rawKey,
    now,
    uploadId,
    now,
    tripId,
    tripId,
    expectedTripRevision,
  ).run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new TravelRepositoryError("upload_conflict", "Upload transaction could not be reserved.", 409);
  }
}

export async function failTravelUpload(
  uploadId: string,
  binding: D1Database | null = travelDatabase(),
): Promise<void> {
  const db = database(binding);
  const now = canonicalIso();
  await db.prepare(
    `UPDATE travel_uploads SET status = 'failed', updated_at = ?
     WHERE id = ? AND status = 'issued'`,
  ).bind(now, uploadId).run();
}

export async function finalizeTravelUpload(
  uploadId: string,
  input: TravelPhotoInput,
  expectedTripRevision: string,
  actorEmail: string,
  binding: D1Database | null = travelDatabase(),
): Promise<{ photo: TravelPhotoDraft; tripRevision: string }> {
  const db = database(binding);
  const upload = await db.prepare(
    `SELECT uploads.id, uploads.trip_id AS tripId, uploads.status,
            uploads.storage_key AS storageKey,
            processed_width AS processedWidth,
            processed_height AS processedHeight,
            uploads.expires_at AS expiresAt,
            trips.revision AS tripRevision
     FROM travel_uploads AS uploads
     JOIN travel_trips AS trips ON trips.id = uploads.trip_id
     WHERE uploads.id = ? LIMIT 1`,
  ).bind(uploadId).first<{
    id: string;
    tripId: string;
    status: string;
    storageKey: string | null;
    processedWidth: number | null;
    processedHeight: number | null;
    expiresAt: string;
    tripRevision: string;
  }>();
  if (
    !upload ||
    upload.status !== "uploaded" ||
    !upload.storageKey ||
    !Number.isInteger(upload.processedWidth) ||
    !Number.isInteger(upload.processedHeight)
  ) {
    throw new TravelRepositoryError("upload_not_ready", "Upload is not ready to finalize.", 409);
  }
  const processedWidth = Number(upload.processedWidth);
  const processedHeight = Number(upload.processedHeight);
  if (Date.parse(upload.expiresAt) <= Date.now()) {
    throw new TravelRepositoryError("upload_expired", "Upload transaction expired.", 410);
  }
  if (upload.tripRevision !== expectedTripRevision) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The trip changed after the upload was reviewed.",
      409,
    );
  }
  if (input.placeId) {
    const place = await db.prepare(`SELECT trip_id AS tripId FROM travel_places WHERE id = ? LIMIT 1`).bind(input.placeId).first<{ tripId: string }>();
    if (!place || place.tripId !== upload.tripId) {
      throw new TravelRepositoryError("invalid_place", "The selected place does not belong to this trip.", 400);
    }
  }
  const photoId = id("photo");
  const nextRevision = revision();
  const nextTripRevision = revision();
  const siblingRevision = revision();
  const now = canonicalIso();
  const statements: D1PreparedStatement[] = [];
  statements.push(
    db.prepare(
      `INSERT INTO travel_photos (
         id, trip_id, place_id, storage_key, alt_text, caption,
         captured_at, capture_precision, width, height, sort_order,
         is_cover, revision, created_at, updated_at
       ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM travel_uploads
         WHERE id = ? AND status = 'uploaded' AND storage_key = ?
       ) AND EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      photoId,
      upload.tripId,
      input.placeId,
      upload.storageKey,
      input.altText,
      input.caption,
      input.capturedAt,
      input.capturePrecision,
      processedWidth,
      processedHeight,
      input.sortOrder,
      input.isCover ? 1 : 0,
      nextRevision,
      now,
      now,
      uploadId,
      upload.storageKey,
      upload.tripId,
      expectedTripRevision,
    ),
  );
  if (input.isCover) {
    statements.push(
      db.prepare(
        `UPDATE travel_photos
         SET is_cover = 0, revision = ?, updated_at = ?
         WHERE trip_id = ? AND id != ? AND is_cover = 1
           AND EXISTS (SELECT 1 FROM travel_photos WHERE id = ?)`,
      ).bind(siblingRevision, now, upload.tripId, photoId, photoId),
    );
  }
  for (const tag of input.tags) {
    statements.push(
      db.prepare(
        `INSERT INTO travel_photo_tags (photo_id, tag)
         SELECT ?, ? WHERE EXISTS (SELECT 1 FROM travel_photos WHERE id = ?)`,
      ).bind(photoId, tag, photoId),
    );
  }
  const uploadUpdateIndex = statements.length;
  statements.push(
    db.prepare(
      `UPDATE travel_uploads
       SET status = 'consumed', consumed_at = ?, token_hash = '', updated_at = ?
       WHERE id = ? AND status = 'uploaded'
         AND EXISTS (SELECT 1 FROM travel_photos WHERE id = ?)`,
    ).bind(now, now, uploadId, photoId),
  );
  const tripUpdateIndex = statements.length;
  statements.push(
    db.prepare(
      `UPDATE travel_trips
       SET revision = ?, updated_at = ?
       WHERE id = ? AND revision = ?
         AND EXISTS (SELECT 1 FROM travel_photos WHERE id = ?)`,
    ).bind(
      nextTripRevision,
      now,
      upload.tripId,
      expectedTripRevision,
      photoId,
    ),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       ) SELECT ?, ?, 'travel.photo_created', 'travel_photo', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      photoId,
      JSON.stringify({ tripId: upload.tripId }),
      now,
      upload.tripId,
      nextTripRevision,
    ),
  );
  const results = await db.batch(statements);
  if (
    (results[0]?.meta.changes ?? 0) !== 1 ||
    (results[uploadUpdateIndex]?.meta.changes ?? 0) !== 1 ||
    (results[tripUpdateIndex]?.meta.changes ?? 0) !== 1
  ) {
    throw new TravelRepositoryError(
      "revision_conflict",
      "The trip or upload changed while the photo was finalized.",
      409,
    );
  }
  return {
    photo: {
      id: photoId,
      tripId: upload.tripId,
      placeId: input.placeId,
      altText: input.altText,
      caption: input.caption,
      capturedAt: input.capturedAt,
      capturePrecision: input.capturePrecision,
      width: processedWidth,
      height: processedHeight,
      tags: input.tags,
      sortOrder: input.sortOrder,
      isCover: input.isCover,
      previewSrc: `/api/studio/travel/photos/${encodeURIComponent(photoId)}/preview`,
      revision: nextRevision,
    },
    tripRevision: nextTripRevision,
  };
}

export async function findPrivateTravelPhotoStorage(
  photoId: string,
  binding: D1Database | null = travelDatabase(),
): Promise<{ storageKey: string } | null> {
  const db = database(binding);
  const row = await db.prepare(
    `SELECT storage_key AS storageKey
     FROM travel_photos
     WHERE id = ?
     LIMIT 1`,
  ).bind(photoId).first<{ storageKey: string }>();
  return row?.storageKey?.startsWith("private/travel/masters/") ? row : null;
}

async function projectionRowsForTrip(
  db: D1Database,
  tripId: string,
  publishedAt: string,
): Promise<TravelProjectionRows> {
  const trips = await db.prepare(
    `SELECT id, slug, title, summary, status,
            period_start AS periodStart, period_end AS periodEnd,
            period_precision AS periodPrecision,
            COALESCE(published_at, ?) AS publishedAt
     FROM travel_trips WHERE id = ?
     ORDER BY period_start DESC, title COLLATE NOCASE, id`,
  ).bind(publishedAt, tripId).all<TravelProjectionTripRow>();
  const visible = new Set((trips.results ?? []).map((trip) => trip.id));
  const [places, photos, tags] = await Promise.all([
    db.prepare(
      `SELECT places.id, places.trip_id AS tripId, places.label,
              places.country_code AS countryCode, places.country_name AS countryName,
              places.admin1_code AS admin1Code, places.admin1_name AS admin1Name,
              places.precision, places.public_lat AS publicLat,
              places.public_lng AS publicLng, places.sort_order AS sortOrder
       FROM travel_places AS places
       WHERE places.trip_id = ?
       ORDER BY places.trip_id, places.sort_order, places.id`,
    ).bind(tripId).all<TravelProjectionPlaceRow>(),
    db.prepare(
      `SELECT photos.id, photos.trip_id AS tripId, photos.place_id AS placeId,
              photos.alt_text AS altText, photos.caption,
              photos.captured_at AS capturedAt,
              photos.capture_precision AS capturePrecision,
              photos.width, photos.height, photos.sort_order AS sortOrder,
              photos.is_cover AS isCover, photos.storage_key AS storageKey
       FROM travel_photos AS photos
       WHERE photos.trip_id = ?
       ORDER BY photos.trip_id, photos.sort_order, photos.id`,
    ).bind(tripId).all<TravelProjectionPhotoRow>(),
    db.prepare(
      `SELECT tags.photo_id AS photoId, tags.tag
       FROM travel_photo_tags AS tags
       JOIN travel_photos AS photos ON photos.id = tags.photo_id
       WHERE photos.trip_id = ?
       ORDER BY tags.photo_id, tags.tag`,
    ).bind(tripId).all<TravelProjectionTagRow>(),
  ]);
  return {
    trips: trips.results ?? [],
    places: (places.results ?? []).filter((row) => visible.has(row.tripId)),
    photos: (photos.results ?? []).filter((row) => visible.has(row.tripId)),
    tags: tags.results ?? [],
  };
}

/**
 * Project the persisted owner draft through the exact publication projector.
 * This is read-only: it neither creates a publication snapshot nor changes the
 * active D1/KV pointer.
 */
export async function getTravelTripDraftPreview(
  tripId: string,
  binding: D1Database | null = travelDatabase(),
): Promise<TravelTripPreview> {
  const db = database(binding);
  const projectedAt = canonicalIso();
  const rows = await projectionRowsForTrip(db, tripId, projectedAt);
  let snapshot: TravelPublicationSnapshot;
  try {
    snapshot = await projectTravelAtlas(rows, projectedAt);
  } catch {
    throw new TravelRepositoryError(
      "preview_not_publishable",
      "The stored trip does not yet satisfy the public travel contract.",
      400,
    );
  }
  const preview = projectTravelTripPreview(snapshot, tripId);
  if (!preview) {
    throw new TravelRepositoryError("trip_not_found", "Trip not found.", 404);
  }
  return preview;
}

type TravelKvPointer = {
  schemaVersion: "1.0";
  versionKey: string;
  contentHash: string;
  activatedAt: string;
};

type TravelFallbackGate = {
  schemaVersion: "1.0";
  state: "closed" | "open";
  contentHash: string;
  updatedAt: string;
};

function parsePointer(value: string | null): TravelKvPointer | null {
  if (!value || value.length > 2_048) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      Object.keys(parsed).length !== 4 ||
      parsed.schemaVersion !== "1.0" ||
      typeof parsed.versionKey !== "string" ||
      !parsed.versionKey.startsWith(TRAVEL_VERSION_PREFIX) ||
      typeof parsed.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.contentHash) ||
      typeof parsed.activatedAt !== "string" ||
      new Date(parsed.activatedAt).toISOString() !== parsed.activatedAt
    ) return null;
    return parsed as TravelKvPointer;
  } catch {
    return null;
  }
}

function parseFallbackGate(value: string | null): TravelFallbackGate | null {
  if (!value || value.length > 2_048) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      Object.keys(parsed).length !== 4 ||
      parsed.schemaVersion !== "1.0" ||
      !(parsed.state === "closed" || parsed.state === "open") ||
      typeof parsed.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.contentHash) ||
      typeof parsed.updatedAt !== "string" ||
      new Date(parsed.updatedAt).toISOString() !== parsed.updatedAt
    ) return null;
    return parsed as TravelFallbackGate;
  } catch {
    return null;
  }
}

export async function readTravelKvSnapshot(kv: KVNamespace | null) {
  if (!kv) return null;
  try {
    const gate = parseFallbackGate(
      await kv.get(TRAVEL_FALLBACK_GATE_KEY, "text"),
    );
    if (!gate || gate.state !== "open") return null;
    const pointer = parsePointer(await kv.get(TRAVEL_POINTER_KEY, "text"));
    if (!pointer || pointer.contentHash !== gate.contentHash) return null;
    const envelopeRaw = await kv.get(pointer.versionKey, "text");
    if (!envelopeRaw || envelopeRaw.length > 16 * 1024 * 1024) return null;
    const envelope = JSON.parse(envelopeRaw) as Record<string, unknown>;
    if (
      Object.keys(envelope).length !== 4 ||
      envelope.schemaVersion !== "1.0" ||
      typeof envelope.snapshotJson !== "string" ||
      envelope.contentHash !== pointer.contentHash ||
      typeof envelope.replicatedAt !== "string"
    ) return null;
    const snapshot = await parseTravelAtlasSnapshotJson(envelope.snapshotJson);
    return snapshot?.contentHash === pointer.contentHash ? snapshot : null;
  } catch {
    return null;
  }
}

type ActiveTravelPublication = {
  snapshotId: string;
  contentHash: string;
  snapshot: TravelPublicationSnapshot;
};

async function readActiveD1TravelPublication(
  db: D1Database,
): Promise<ActiveTravelPublication | null> {
  const row = await db.prepare(
    `SELECT state.snapshot_id AS snapshotId,
            state.content_hash AS contentHash,
            snapshots.snapshot_json AS snapshotJson
     FROM travel_publication_state AS state
     JOIN travel_publication_snapshots AS snapshots
       ON snapshots.id = state.snapshot_id
     WHERE state.id = 'current' LIMIT 1`,
  ).first<Required<SnapshotRow>>();
  if (!row) return null;
  const snapshot = await parseTravelAtlasSnapshotJson(row.snapshotJson);
  if (!snapshot || snapshot.contentHash !== row.contentHash) {
    throw new TravelRepositoryError(
      "publication_state_invalid",
      "The active travel publication could not be verified.",
      503,
    );
  }
  return {
    snapshotId: row.snapshotId,
    contentHash: row.contentHash,
    snapshot,
  };
}

async function activateTravelKvSnapshot(
  kv: KVNamespace,
  snapshot: TravelPublicationSnapshot,
  activatedAt: string,
): Promise<void> {
  const snapshotJson = JSON.stringify(snapshot);
  const versionKey = travelPublicationVersionKey(
    snapshot.contentHash,
    activatedAt,
  );
  await kv.put(
    versionKey,
    JSON.stringify({
      schemaVersion: "1.0",
      snapshotJson,
      contentHash: snapshot.contentHash,
      replicatedAt: activatedAt,
    }),
  );
  await kv.put(
    TRAVEL_POINTER_KEY,
    JSON.stringify({
      schemaVersion: "1.0",
      versionKey,
      contentHash: snapshot.contentHash,
      activatedAt,
    } satisfies TravelKvPointer),
  );
  await kv.put(
    TRAVEL_FALLBACK_GATE_KEY,
    JSON.stringify({
      schemaVersion: "1.0",
      state: "open",
      contentHash: snapshot.contentHash,
      updatedAt: activatedAt,
    } satisfies TravelFallbackGate),
  );
}

export async function currentTravelSnapshot(
  binding: D1Database | null = travelDatabase(),
  kv: KVNamespace | null = travelPublicationKv(),
) {
  if (binding) {
    try {
      const row = await binding.prepare(
        `SELECT snapshots.snapshot_json AS snapshotJson,
                snapshots.content_hash AS contentHash
         FROM travel_publication_state AS state
         JOIN travel_publication_snapshots AS snapshots
           ON snapshots.id = state.snapshot_id
         WHERE state.id = 'current' LIMIT 1`,
      ).first<SnapshotRow>();
      if (row) {
        const snapshot = await parseTravelAtlasSnapshotJson(row.snapshotJson);
        if (snapshot && snapshot.contentHash === row.contentHash) return snapshot;
      }
    } catch {
      // A verified KV snapshot remains the only fallback.
    }
  }
  return readTravelKvSnapshot(kv);
}

export async function publishTravelTrip(
  tripId: string,
  expectedRevision: string,
  actorEmail: string,
  publish: boolean,
  binding: D1Database | null = travelDatabase(),
  kv: KVNamespace | null = travelPublicationKv(),
): Promise<TravelTripDraft> {
  const db = database(binding);
  const trip = await requireTripDraft(db, tripId);
  if (trip.revision !== expectedRevision) {
    throw new TravelRepositoryError("revision_conflict", "The trip changed after it was loaded.", 409);
  }
  if (publish) {
    if (trip.places.length === 0) {
      throw new TravelRepositoryError("trip_incomplete", "Add at least one reviewed place before publishing.", 400);
    }
    const issue = publicationSafetyIssue({
      status: trip.status,
      period: trip.period,
      places: trip.places,
      photoCount: trip.photos.length,
    });
    if (issue) throw new TravelRepositoryError("unsafe_publication", issue, 400);
    if (trip.status === "completed" && trip.photos.some((photo) => !photo.placeId || !photo.altText.trim())) {
      throw new TravelRepositoryError(
        "trip_incomplete",
        "Every completed-trip photo needs a reviewed place and alt text.",
        400,
      );
    }
  }
  const now = canonicalIso();
  const active = await readActiveD1TravelPublication(db);
  const replacement = publish
    ? (await projectTravelAtlas(
        await projectionRowsForTrip(db, tripId, now),
        now,
      )).trips[0] ?? null
    : null;
  if (publish && !replacement) {
    throw new TravelRepositoryError(
      "trip_not_found",
      "Trip not found.",
      404,
    );
  }
  const snapshot = await replaceTravelPublicationTrip(
    active?.snapshot ?? null,
    tripId,
    replacement,
    now,
  );
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotId = id("travelpub");
  const nextRevision = revision();
  const versionKey = travelPublicationVersionKey(snapshot.contentHash, now);
  if (kv) {
    await kv.put(
      TRAVEL_FALLBACK_GATE_KEY,
      JSON.stringify({
        schemaVersion: "1.0",
        state: "closed",
        contentHash: snapshot.contentHash,
        updatedAt: now,
      } satisfies TravelFallbackGate),
    );
    await kv.put(
      versionKey,
      JSON.stringify({
        schemaVersion: "1.0",
        snapshotJson,
        contentHash: snapshot.contentHash,
        replicatedAt: now,
      }),
    );
  }
  const publicationCas = active
    ? db.prepare(
        `UPDATE travel_publication_state
         SET snapshot_id = ?, content_hash = ?, updated_at = ?
         WHERE id = 'current' AND snapshot_id = ? AND content_hash = ?
           AND EXISTS (
             SELECT 1 FROM travel_publication_snapshots WHERE id = ?
           )
           AND EXISTS (
             SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
           )`,
      ).bind(
        snapshotId,
        snapshot.contentHash,
        now,
        active.snapshotId,
        active.contentHash,
        snapshotId,
        tripId,
        expectedRevision,
      )
    : db.prepare(
        `INSERT INTO travel_publication_state (
           id, snapshot_id, content_hash, updated_at
         ) SELECT 'current', ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM travel_publication_state WHERE id = 'current'
         )
           AND EXISTS (
             SELECT 1 FROM travel_publication_snapshots WHERE id = ?
           )
           AND EXISTS (
             SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
           )
         ON CONFLICT(id) DO NOTHING`,
      ).bind(
        snapshotId,
        snapshot.contentHash,
        now,
        snapshotId,
        tripId,
        expectedRevision,
      );
  const [snapshotInsert, stateCas, tripUpdate] = await db.batch([
    db.prepare(
      `INSERT INTO travel_publication_snapshots (
         id, snapshot_json, content_hash, trip_count, photo_count,
         published_by_email, published_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      snapshotId,
      snapshotJson,
      snapshot.contentHash,
      snapshot.counts.trips,
      snapshot.counts.photos,
      actorEmail,
      now,
    ),
    publicationCas,
    db.prepare(
      `UPDATE travel_trips
       SET published_at = ?, revision = ?, updated_at = ?
       WHERE id = ? AND revision = ?
         AND EXISTS (
           SELECT 1 FROM travel_publication_state
           WHERE id = 'current' AND snapshot_id = ? AND content_hash = ?
         )`,
    ).bind(
      publish ? now : null,
      nextRevision,
      now,
      tripId,
      expectedRevision,
      snapshotId,
      snapshot.contentHash,
    ),
    db.prepare(
      `INSERT INTO audit_log (
         id, actor_email, action, entity_type, entity_id, details_json, created_at
       )
       SELECT ?, ?, ?, 'travel_trip', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM travel_publication_state
         WHERE id = 'current' AND snapshot_id = ? AND content_hash = ?
       ) AND EXISTS (
         SELECT 1 FROM travel_trips WHERE id = ? AND revision = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      actorEmail,
      publish ? "travel.trip_published" : "travel.trip_unpublished",
      tripId,
      JSON.stringify({ contentHash: snapshot.contentHash, tripCount: snapshot.counts.trips, photoCount: snapshot.counts.photos }),
      now,
      snapshotId,
      snapshot.contentHash,
      tripId,
      nextRevision,
    ),
  ]);
  if (
    (snapshotInsert.meta.changes ?? 0) !== 1 ||
    (stateCas.meta.changes ?? 0) !== 1 ||
    (tripUpdate.meta.changes ?? 0) !== 1
  ) {
    await db.prepare(
      `DELETE FROM travel_publication_snapshots
       WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM travel_publication_state WHERE snapshot_id = ?
       )`,
    ).bind(snapshotId, snapshotId).run().catch(() => undefined);
    if (kv) {
      // A competing publisher may have won after our initial read. Repair the
      // fallback from the *committed* D1 pointer, never from the stale value we
      // originally observed. This keeps KV from rolling back a concurrent win.
      try {
        const committed = await readActiveD1TravelPublication(db);
        if (committed) {
          const repairAt = canonicalIso();
          await activateTravelKvSnapshot(kv, committed.snapshot, repairAt);
          const repairedVersionKey = travelPublicationVersionKey(
            committed.snapshot.contentHash,
            repairAt,
          );
          if (repairedVersionKey !== versionKey) {
            await kv.delete(versionKey);
          }
        } else {
          await kv.delete(versionKey);
        }
      } catch {
        // The pre-commit gate remains closed. D1 is authoritative and a later
        // successful publication or maintenance pass can restore KV fallback.
      }
    }
    throw new TravelRepositoryError(
      "revision_conflict",
      "The trip or active publication changed while publication was being prepared.",
      409,
    );
  }
  if (kv) {
    await activateTravelKvSnapshot(kv, snapshot, now);
  }
  return requireTripDraft(db, tripId);
}

export async function getPublicTravelAtlas(
  binding: D1Database | null = travelDatabase(),
  kv: KVNamespace | null = travelPublicationKv(),
  previewScenario: TravelPreviewScenario = "ready",
): Promise<PublicTravelAtlasEnvelope> {
  if (travelPreviewRuntime()) {
    return {
      status: "ready",
      atlas: projectPublicTravelAtlas(await previewTravelAtlas(previewScenario)),
    };
  }
  const atlas = await currentTravelSnapshot(binding, kv);
  return atlas
    ? { status: "ready", atlas: projectPublicTravelAtlas(atlas) }
    : {
        status: "unavailable",
        message: "The travel atlas has not been published yet.",
      };
}

export async function getPublicTravelTrip(
  slug: string,
  page: number,
  pageSize: 12 | 24 | 36,
  binding: D1Database | null = travelDatabase(),
  kv: KVNamespace | null = travelPublicationKv(),
  previewScenario: TravelPreviewScenario = "ready",
): Promise<PublicTravelTripEnvelope> {
  const snapshot = travelPreviewRuntime()
    ? await previewTravelAtlas(previewScenario)
    : await currentTravelSnapshot(binding, kv);
  if (!snapshot) {
    return { status: "unavailable", message: "The travel atlas has not been published yet." };
  }
  const trip = snapshot.trips.find((candidate) => candidate.slug === slug);
  if (!trip) return { status: "not_found", message: "Trip not found." };
  const pages = Math.max(1, Math.ceil(trip.photos.length / pageSize));
  if (page > pages) return { status: "not_found", message: "Photo page not found." };
  const detail: TravelTripDetail = {
    ...trip,
    photos: trip.photos.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total: trip.photos.length, pages },
  };
  return { status: "ready", trip: detail };
}

export async function findPublishedTravelMedia(
  photoId: string,
  digest: string,
  binding: D1Database | null = travelDatabase(),
): Promise<{ storageKey: string } | null> {
  // Media authorization deliberately requires the current D1 publication.
  // A last-known-good KV atlas may keep text available during an incident,
  // but it must never keep an unpublished image retrievable.
  if (!binding) return null;
  const active = await binding.prepare(
    `SELECT snapshots.snapshot_json AS snapshotJson,
            snapshots.content_hash AS contentHash
     FROM travel_publication_state AS state
     JOIN travel_publication_snapshots AS snapshots
       ON snapshots.id = state.snapshot_id
     WHERE state.id = 'current'
     LIMIT 1`,
  ).first<SnapshotRow>();
  const snapshot = active
    ? await parseTravelAtlasSnapshotJson(active.snapshotJson)
    : null;
  if (
    !snapshot ||
    snapshot.contentHash !== active?.contentHash ||
    !snapshotContainsPhoto(snapshot, photoId, digest)
  ) return null;
  const row = await binding.prepare(
    `SELECT storage_key AS storageKey FROM travel_photos WHERE id = ? LIMIT 1`,
  ).bind(photoId).first<{ storageKey: string }>();
  return row?.storageKey ? { storageKey: row.storageKey } : null;
}

export function travelPrivateHeaders(): typeof PRIVATE_HEADERS {
  return PRIVATE_HEADERS;
}
