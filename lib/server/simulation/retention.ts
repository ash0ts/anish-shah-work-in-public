import { simulationBudgetCutoff } from "./budget-repository";

const SESSION_RETENTION_MS = 2 * 60 * 60 * 1_000;

export async function pruneSimulationRetention(
  database: D1Database,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const sessionCutoff = new Date(
    now.getTime() - SESSION_RETENTION_MS,
  ).toISOString();
  await database.batch([
    database
      .prepare(
        `DELETE FROM simulation_sessions
         WHERE expires_at <= ? OR updated_at <= ?`,
      )
      .bind(nowIso, sessionCutoff),
    database
      .prepare(`DELETE FROM simulation_daily_budget WHERE budget_date < ?`)
      .bind(simulationBudgetCutoff(now)),
  ]);
}
