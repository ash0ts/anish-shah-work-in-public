import { parseTravelAtlasSnapshotJson } from "./projector";
import { travelPublicationVersionKey } from "./repository";
import {
  travelDatabase,
  travelImagesBinding,
  travelMediaBucket,
  travelPublicationKv,
} from "./runtime";

export const TRAVEL_CLEANUP_MAINTENANCE_KEY = "travel.cleanup";

export type TravelHealth = {
  configured: boolean;
  activePublication: {
    contentHash: string;
    counts: {
      trips: number;
      countries: number;
      regions: number;
      places: number;
      photos: number;
    };
    publishedAt: string;
  } | null;
  cleanupHeartbeat: {
    status: "current" | "stale" | "never_run" | "error";
    checkedAt: string | null;
  };
};

type HealthSnapshotRow = {
  snapshotJson: string;
};

type MaintenanceRow = {
  status: string;
  checkedAt: string;
};

type MediaDeletionRow = {
  id: string;
  storageKeysJson: string;
};

function validDeletionKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    (/^private\/travel\/masters\/upload_[A-Za-z0-9-]+\/source\.webp$/.test(key) ||
      /^private\/travel\/variants\/photo_[A-Za-z0-9-]+\/[a-f0-9]{64}\/(?:480|960|1920)\.webp$/.test(key) ||
      /^temporary\/travel\/upload_[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/.test(key))
  );
}

function deletionKeys(value: string): string[] | null {
  if (value.length > 32_768) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.length <= 100 &&
      parsed.every(validDeletionKey) &&
      new Set(parsed).size === parsed.length
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function getTravelHealth(
  binding: D1Database | null = travelDatabase(),
  now = Date.now(),
  options: { mediaConfigured?: boolean; imagesConfigured?: boolean } = {},
): Promise<TravelHealth> {
  const mediaConfigured =
    options.mediaConfigured ?? Boolean(travelMediaBucket());
  const imagesConfigured =
    options.imagesConfigured ?? Boolean(travelImagesBinding());
  if (!binding || !mediaConfigured || !imagesConfigured) {
    return {
      configured: false,
      activePublication: null,
      cleanupHeartbeat: { status: "never_run", checkedAt: null },
    };
  }
  try {
    const [snapshotRow, maintenanceRow] = await Promise.all([
      binding.prepare(
        `SELECT snapshots.snapshot_json AS snapshotJson
         FROM travel_publication_state AS state
         JOIN travel_publication_snapshots AS snapshots
           ON snapshots.id = state.snapshot_id
         WHERE state.id = 'current'
         LIMIT 1`,
      ).first<HealthSnapshotRow>(),
      binding.prepare(
        `SELECT status, checked_at AS checkedAt
         FROM maintenance_state
         WHERE key = ?
         LIMIT 1`,
      ).bind(TRAVEL_CLEANUP_MAINTENANCE_KEY).first<MaintenanceRow>(),
    ]);
    const snapshot = snapshotRow
      ? await parseTravelAtlasSnapshotJson(snapshotRow.snapshotJson)
      : null;
    const checkedTime = Date.parse(maintenanceRow?.checkedAt ?? "");
    const cleanupStatus: TravelHealth["cleanupHeartbeat"]["status"] =
      maintenanceRow?.status === "error"
        ? "error"
        : !maintenanceRow || !Number.isFinite(checkedTime)
          ? "never_run"
          : now - checkedTime > 3 * 60 * 60 * 1000
            ? "stale"
            : "current";
    return {
      configured: true,
      activePublication: snapshot
        ? {
            contentHash: snapshot.contentHash,
            counts: snapshot.counts,
            publishedAt: snapshot.publishedAt,
          }
        : null,
      cleanupHeartbeat: {
        status: cleanupStatus,
        checkedAt: maintenanceRow?.checkedAt ?? null,
      },
    };
  } catch {
    return {
      configured: false,
      activePublication: null,
      cleanupHeartbeat: { status: "error", checkedAt: null },
    };
  }
}

export async function pruneTravelRetention(
  database: D1Database,
  now: Date | number | string = new Date(),
): Promise<{
  removedUploads: number;
  removedSnapshots: number;
  removedMedia: number;
  deletionFailures: number;
  pendingDeletions: number;
}> {
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    throw new Error("Travel retention requires a valid timestamp.");
  }
  const checkedAt = nowDate.toISOString();
  const consumedBefore = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const snapshotBefore = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const expired = await database.prepare(
    `SELECT id, status, storage_key AS storageKey
     FROM travel_uploads
     WHERE (expires_at <= ? AND status != 'consumed')
        OR (status = 'consumed' AND consumed_at IS NOT NULL AND consumed_at <= ?)
     LIMIT 1000`,
  ).bind(checkedAt, consumedBefore).all<{
    id: string;
    status: string;
    storageKey: string | null;
  }>();
  const rows = expired.results ?? [];
  let removedUploads = 0;
  let removedMedia = 0;
  let deletionFailures = 0;
  const bucket = travelMediaBucket();
  for (const row of rows) {
    if (row.status !== "consumed") {
      if (!bucket) {
        deletionFailures += 1;
        continue;
      }
      const keys = [...new Set([
        ...(row.storageKey &&
        (row.storageKey.startsWith("private/travel/masters/") ||
          row.storageKey.startsWith("temporary/travel/"))
          ? [row.storageKey]
          : []),
        `private/travel/masters/${row.id}/source.webp`,
      ])];
      try {
        await bucket.delete(keys);
        removedMedia += keys.length;
      } catch {
        // Keep the durable upload row so the next maintenance pass retries.
        deletionFailures += 1;
        continue;
      }
    }
    const result = await database.prepare(
      `DELETE FROM travel_uploads WHERE id = ?`,
    ).bind(row.id).run();
    removedUploads += result.meta.changes ?? 0;
  }

  const pendingDeletions = await database.prepare(
    `SELECT id, storage_keys_json AS storageKeysJson
     FROM travel_media_deletions
     WHERE status = 'pending'
     ORDER BY updated_at ASC
     LIMIT 250`,
  ).all<MediaDeletionRow>();
  for (const deletion of pendingDeletions.results ?? []) {
    const keys = deletionKeys(deletion.storageKeysJson);
    if (!keys || !bucket) {
      deletionFailures += 1;
      await database.prepare(
        `UPDATE travel_media_deletions
         SET attempts = attempts + 1, last_error_code = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      ).bind(keys ? "media_unavailable" : "invalid_storage_keys", checkedAt, deletion.id).run();
      continue;
    }
    try {
      await bucket.delete(keys);
      removedMedia += keys.length;
      await database.prepare(
        `UPDATE travel_media_deletions
         SET status = 'complete', attempts = attempts + 1,
             last_error_code = NULL, completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      ).bind(checkedAt, checkedAt, deletion.id).run();
    } catch {
      deletionFailures += 1;
      await database.prepare(
        `UPDATE travel_media_deletions
         SET attempts = attempts + 1, last_error_code = 'r2_delete_failed',
             updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      ).bind(checkedAt, deletion.id).run();
    }
  }
  await database.prepare(
    `DELETE FROM travel_media_deletions
     WHERE status = 'complete' AND completed_at IS NOT NULL AND completed_at <= ?`,
  ).bind(consumedBefore).run();
  const snapshots = await database.prepare(
    `SELECT snapshots.id, snapshots.content_hash AS contentHash,
            snapshots.published_at AS publishedAt
     FROM travel_publication_snapshots AS snapshots
     LEFT JOIN travel_publication_state AS state
       ON state.snapshot_id = snapshots.id
     WHERE state.snapshot_id IS NULL AND snapshots.published_at <= ?
     ORDER BY snapshots.published_at ASC
     LIMIT 1000`,
  ).bind(snapshotBefore).all<{
    id: string;
    contentHash: string;
    publishedAt: string;
  }>();
  let removedSnapshots = 0;
  const publicationKv = travelPublicationKv();
  for (const row of snapshots.results ?? []) {
    if (publicationKv) {
      await publicationKv.delete(
        travelPublicationVersionKey(row.contentHash, row.publishedAt),
      );
    }
    const result = await database.prepare(
      `DELETE FROM travel_publication_snapshots
       WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM travel_publication_state WHERE snapshot_id = ?
       )`,
    ).bind(row.id, row.id).run();
    removedSnapshots += result.meta.changes ?? 0;
  }
  const pendingRow = await database.prepare(
    `SELECT COUNT(*) AS count
     FROM travel_media_deletions
     WHERE status = 'pending'`,
  ).first<{ count: number }>();
  const pendingDeletionCount = Number(pendingRow?.count ?? 0);
  const maintenanceStatus =
    deletionFailures > 0 || pendingDeletionCount > 0 ? "error" : "complete";
  const details = JSON.stringify({
    removedUploads,
    removedSnapshots,
    removedMedia,
    deletionFailures,
    pendingDeletions: pendingDeletionCount,
  });
  await database.prepare(
    `INSERT INTO maintenance_state (
       key, status, details_json, checked_at, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       status = excluded.status,
       details_json = excluded.details_json,
       checked_at = excluded.checked_at,
       updated_at = excluded.updated_at`,
  ).bind(
    TRAVEL_CLEANUP_MAINTENANCE_KEY,
    maintenanceStatus,
    details,
    checkedAt,
    checkedAt,
  ).run();
  return {
    removedUploads,
    removedSnapshots,
    removedMedia,
    deletionFailures,
    pendingDeletions: pendingDeletionCount,
  };
}
