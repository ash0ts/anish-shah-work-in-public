export const RETENTION_MAINTENANCE_KEY = "retention.cleanup";
export const PUBLICATION_MAINTENANCE_KEY = "publication.fallback";
export const RELEASE_PUBLICATION_MAINTENANCE_KEY = "release.publication_ready";

export async function recordMaintenanceState(
  database: D1Database,
  key: string,
  status: "ready" | "complete" | "error",
  details: Record<string, unknown>,
  checkedAt = new Date().toISOString(),
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO maintenance_state (
         key, status, details_json, checked_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         status = excluded.status,
         details_json = excluded.details_json,
         checked_at = excluded.checked_at,
         updated_at = excluded.updated_at`,
    )
    .bind(key, status, JSON.stringify(details), checkedAt, checkedAt)
    .run();
}
