import { getDiscogsPresentationConfig } from "./discogs-presentation";
import { refreshConnectorUsingDatabase } from "./repository-refresh";
import type { RefreshResult } from "./repository-contracts";

const DISCOGS_REFRESH_AFTER_MS = 4 * 60 * 60 * 1000;

export type ScheduledDiscogsRefreshResult =
  | RefreshResult
  | { status: "not_configured" | "not_published" | "not_due" };

export async function refreshDiscogsWhenDue(
  database: D1Database,
  now = new Date(),
): Promise<ScheduledDiscogsRefreshResult> {
  const presentation = await getDiscogsPresentationConfig(database);
  if (
    presentation.status !== "ready" ||
    !presentation.config.publishCollection
  ) {
    return { status: "not_published" };
  }

  const credential = await database
    .prepare(
      `SELECT provider
       FROM connector_credentials
       WHERE provider = 'discogs'
       LIMIT 1`,
    )
    .first<{ provider: string }>();
  if (!credential) return { status: "not_configured" };

  const snapshot = await database
    .prepare(
      `SELECT fetched_at AS fetchedAt
       FROM connector_snapshots
       WHERE provider = 'discogs' AND status = 'ready'
       ORDER BY fetched_at DESC
       LIMIT 1`,
    )
    .first<{ fetchedAt: string }>();
  if (snapshot) {
    const fetchedAt = Date.parse(snapshot.fetchedAt);
    if (
      Number.isFinite(fetchedAt) &&
      now.getTime() - fetchedAt < DISCOGS_REFRESH_AFTER_MS
    ) {
      return { status: "not_due" };
    }
  }

  return refreshConnectorUsingDatabase(
    database,
    "discogs",
    "stale_revalidate",
    null,
  );
}
