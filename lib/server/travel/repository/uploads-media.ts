import type {
  TravelPhotoDraft,
  TravelUploadTransaction,
} from "@/types/travel";
import {
  TRAVEL_ACCEPTED_MEDIA_TYPES,
  TRAVEL_UPLOAD_MAX_BYTES,
  type TravelPhotoInput,
  type TravelUploadInput,
} from "../policy";
import { travelDatabase } from "../runtime";
import {
  TravelRepositoryError,
  canonicalIso,
  database,
  id,
  revision,
} from "./shared";
import { requireTripDraft } from "./trips-places";

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
