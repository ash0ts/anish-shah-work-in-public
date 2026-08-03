export const DISCOGS_RETRY_MAINTENANCE_KEY = "connector.discogs.retry";

function canonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export async function discogsRetryNotBefore(
  database: D1Database,
  now = Date.now(),
): Promise<string | null> {
  const row = await database
    .prepare(
      `SELECT status, details_json AS detailsJson
       FROM maintenance_state
       WHERE key = ?
       LIMIT 1`,
    )
    .bind(DISCOGS_RETRY_MAINTENANCE_KEY)
    .first<{ status: string; detailsJson: string }>();
  if (!row || row.status !== "ready") return null;
  let details: unknown;
  try {
    details = JSON.parse(row.detailsJson) as unknown;
  } catch {
    return null;
  }
  if (
    typeof details !== "object" ||
    details === null ||
    Array.isArray(details) ||
    Object.keys(details).length !== 1
  ) {
    return null;
  }
  const notBefore = (details as Record<string, unknown>).notBefore;
  return canonicalIsoTimestamp(notBefore) && Date.parse(notBefore) > now
    ? notBefore
    : null;
}

export async function recordDiscogsRetryAfter(
  database: D1Database,
  retryAfterSeconds: number,
  now = Date.now(),
): Promise<string> {
  const boundedSeconds =
    Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 1
      ? Math.min(retryAfterSeconds, 7 * 24 * 60 * 60)
      : 3_600;
  const checkedAt = new Date(now).toISOString();
  const notBefore = new Date(now + boundedSeconds * 1_000).toISOString();
  await database
    .prepare(
      `INSERT INTO maintenance_state (
         key, status, details_json, checked_at, updated_at
       ) VALUES (?, 'ready', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         status = excluded.status,
         details_json = excluded.details_json,
         checked_at = excluded.checked_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      DISCOGS_RETRY_MAINTENANCE_KEY,
      JSON.stringify({ notBefore }),
      checkedAt,
      checkedAt,
    )
    .run();
  return notBefore;
}

export async function clearDiscogsRetry(
  database: D1Database,
): Promise<void> {
  await database
    .prepare(`DELETE FROM maintenance_state WHERE key = ?`)
    .bind(DISCOGS_RETRY_MAINTENANCE_KEY)
    .run();
}
