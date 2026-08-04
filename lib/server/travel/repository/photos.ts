import type {
  TravelPhotoDraft,
  TravelTripDraft,
} from "@/types/travel";
import type { TravelPhotoInput } from "../policy";
import { travelMediaStorageKeys } from "../projector";
import { travelDatabase } from "../runtime";
import {
  TravelRepositoryError,
  canonicalIso,
  database,
  id,
  mapPhoto,
  mediaDeletionStatement,
  revision,
  type PhotoRow,
  type TravelMediaDeletion,
} from "./shared";
import { requireTripDraft } from "./trips-places";

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


