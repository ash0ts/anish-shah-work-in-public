import {
  recordMaintenanceState,
  RETENTION_MAINTENANCE_KEY,
} from "../maintenance-state";

const OAUTH_TRANSACTION_RETENTION_MS = 24 * 60 * 60 * 1000;
const SYNC_RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const PROMOTION_TRANSACTION_RETENTION_MS = 24 * 60 * 60 * 1000;
// Cleanup runs hourly. Subtract one interval so a row cannot remain beyond the
// stated maximum merely because it expired immediately after the prior run.
const MAX_CLEANUP_LAG_MS = 60 * 60 * 1000;

function retentionCutoff(now: Date, maximumAgeMs: number): string {
  return new Date(
    now.getTime() - (maximumAgeMs - MAX_CLEANUP_LAG_MS),
  ).toISOString();
}

export async function pruneConnectorRetention(
  database: D1Database,
  now = new Date(),
): Promise<void> {
  const oauthCutoff = retentionCutoff(now, OAUTH_TRANSACTION_RETENTION_MS);
  const syncCutoff = retentionCutoff(now, SYNC_RUN_RETENTION_MS);
  const auditCutoff = retentionCutoff(now, AUDIT_RETENTION_MS);
  const promotionCutoff = retentionCutoff(
    now,
    PROMOTION_TRANSACTION_RETENTION_MS,
  );
  try {
    const results = await database.batch([
      database
        .prepare(
          `DELETE FROM connector_oauth_transactions
           WHERE expires_at < ?`,
        )
        .bind(oauthCutoff),
      database
        .prepare(
          `DELETE FROM sync_runs
           WHERE started_at < ? AND status <> 'running'`,
        )
        .bind(syncCutoff),
      database
        .prepare(`DELETE FROM audit_log WHERE created_at < ?`)
        .bind(auditCutoff),
      database
        .prepare(
          `UPDATE play_promotion_transactions
           SET status = 'expired', ciphertext = NULL, iv = NULL,
               key_version = NULL, providers_json = '[]', updated_at = ?
           WHERE status = 'staged' AND staged_expires_at <= ?`,
        )
        .bind(now.toISOString(), now.toISOString()),
      database
        .prepare(
          `DELETE FROM play_promotion_transactions
           WHERE created_at < ?`,
        )
        .bind(promotionCutoff),
    ]);
    await recordMaintenanceState(
      database,
      RETENTION_MAINTENANCE_KEY,
      "complete",
      {
        deletedOauthTransactions: results[0]?.meta.changes ?? 0,
        deletedSyncRuns: results[1]?.meta.changes ?? 0,
        deletedAuditRows: results[2]?.meta.changes ?? 0,
        clearedExpiredPromotionPayloads: results[3]?.meta.changes ?? 0,
        deletedPromotionTransactions: results[4]?.meta.changes ?? 0,
      },
      now.toISOString(),
    );
  } catch (error) {
    try {
      await recordMaintenanceState(
        database,
        RETENTION_MAINTENANCE_KEY,
        "error",
        { code: "cleanup_failed" },
        now.toISOString(),
      );
    } catch {
      // The maintenance table itself may be unavailable before migrations.
    }
    throw error;
  }
}
