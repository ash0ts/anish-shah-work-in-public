import type {
  TravelPlaceDraft,
  TravelTripDraft,
} from "@/types/travel";
import {
  normalizeTravelSlug,
  type TravelPlaceInput,
  type TravelTripInput,
  type TravelTripPatch,
} from "../policy";
import { normalizeTrustedTravelPlace } from "../geography-policy";
import { travelMediaStorageKeys } from "../projector";
import { travelDatabase } from "../runtime";
import {
  TravelRepositoryError,
  canonicalIso,
  database,
  id,
  mapPhoto,
  mapPlace,
  mediaDeletionStatement,
  revision,
  type PhotoRow,
  type PlaceRow,
  type TravelMediaDeletion,
} from "./shared";

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

type TagRow = { photoId: string; tag: string };

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

export async function requireTripDraft(
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


