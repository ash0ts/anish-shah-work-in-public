import type {
  PublicTravelAtlasEnvelope,
  PublicTravelTripEnvelope,
  TravelTripDetail,
  TravelTripDraft,
  TravelTripPreview,
} from "@/types/travel";
import {
  parseTravelAtlasSnapshotJson,
  projectPublicTravelAtlas,
  projectTravelAtlas,
  projectTravelTripPreview,
  replaceTravelPublicationTrip,
  snapshotContainsPhoto,
  type TravelProjectionPhotoRow,
  type TravelProjectionPlaceRow,
  type TravelProjectionRows,
  type TravelProjectionTagRow,
  type TravelProjectionTripRow,
  type TravelPublicationSnapshot,
} from "../projector";
import {
  travelDatabase,
  travelPreviewRuntime,
  travelPublicationKv,
} from "../runtime";
import {
  previewTravelAtlas,
  type TravelPreviewScenario,
} from "../preview";
import { publicationSafetyIssue } from "../policy";
import {
  TravelRepositoryError,
  canonicalIso,
  database,
  id,
  revision,
} from "./shared";
import { requireTripDraft } from "./trips-places";

export const TRAVEL_POINTER_KEY = "travel:current:v1";
export const TRAVEL_VERSION_PREFIX = "travel:version:v1:";
export const TRAVEL_FALLBACK_GATE_KEY = "travel:fallback-gate:v1";
const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

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

type SnapshotRow = {
  snapshotId?: string;
  snapshotJson: string;
  contentHash: string;
};

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
