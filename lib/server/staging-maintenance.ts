import { pruneConnectorRetention } from "./connectors/repository-retention";

export type StagingMaintenanceBootstrapResult =
  | { ok: true; checkedAt: string }
  | { ok: false; code: "not_staging" | "binding_unavailable" };

export async function bootstrapStagingRetention(
  database: D1Database | null,
  deploymentTier: string | undefined,
  now = new Date(),
): Promise<StagingMaintenanceBootstrapResult> {
  if (deploymentTier !== "staging") {
    return { ok: false, code: "not_staging" };
  }
  if (!database) {
    return { ok: false, code: "binding_unavailable" };
  }
  if (Number.isNaN(now.getTime())) {
    throw new Error("Staging maintenance requires a valid timestamp.");
  }
  await pruneConnectorRetention(database, now);
  return { ok: true, checkedAt: now.toISOString() };
}
