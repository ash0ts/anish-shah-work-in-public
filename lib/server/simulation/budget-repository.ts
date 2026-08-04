const BUDGET_RETENTION_DAYS = 90;

type BudgetRow = { modelCalls: number; authoredFallbacks: number };
type MaintenanceRow = { checkedAt: string };

export type SimulationUsageHealth = {
  modelCalls: number;
  authoredFallbacks: number;
  lastSuccessfulGenerationAt: string | null;
};

export async function claimSimulationDailyBudget(
  database: D1Database,
  limit: number,
  now = new Date(),
): Promise<boolean> {
  const date = now.toISOString().slice(0, 10);
  const result = await database
    .prepare(
      `INSERT INTO simulation_daily_budget (
         budget_date, model_calls, authored_fallbacks, updated_at
       ) VALUES (?, 1, 0, ?)
       ON CONFLICT(budget_date) DO UPDATE SET
         model_calls = model_calls + 1,
         updated_at = excluded.updated_at
       WHERE model_calls < ?`,
    )
    .bind(date, now.toISOString(), limit)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function recordSimulationFallback(
  database: D1Database,
  now = new Date(),
): Promise<void> {
  const date = now.toISOString().slice(0, 10);
  await database
    .prepare(
      `INSERT INTO simulation_daily_budget (
         budget_date, model_calls, authored_fallbacks, updated_at
       ) VALUES (?, 0, 1, ?)
       ON CONFLICT(budget_date) DO UPDATE SET
         authored_fallbacks = authored_fallbacks + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(date, now.toISOString())
    .run();
}

export async function recordSimulationGenerationSuccess(
  database: D1Database,
  now = new Date(),
): Promise<void> {
  const checkedAt = now.toISOString();
  await database
    .prepare(
      `INSERT INTO maintenance_state (
         key, status, details_json, checked_at, updated_at
       ) VALUES ('simulation_generation', 'healthy', '{"provider":"anthropic"}', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         status = excluded.status,
         details_json = excluded.details_json,
         checked_at = excluded.checked_at,
         updated_at = excluded.updated_at`,
    )
    .bind(checkedAt, checkedAt)
    .run();
}

export async function readSimulationUsageHealth(
  database: D1Database,
  now = new Date(),
): Promise<SimulationUsageHealth> {
  const [budget, maintenance] = await Promise.all([
    database
      .prepare(
        `SELECT model_calls AS modelCalls,
                authored_fallbacks AS authoredFallbacks
         FROM simulation_daily_budget
         WHERE budget_date = ?
         LIMIT 1`,
      )
      .bind(now.toISOString().slice(0, 10))
      .first<BudgetRow>(),
    database
      .prepare(
        `SELECT checked_at AS checkedAt
         FROM maintenance_state
         WHERE key = 'simulation_generation' AND status = 'healthy'
         LIMIT 1`,
      )
      .first<MaintenanceRow>(),
  ]);
  return {
    modelCalls: Number(budget?.modelCalls ?? 0),
    authoredFallbacks: Number(budget?.authoredFallbacks ?? 0),
    lastSuccessfulGenerationAt: maintenance?.checkedAt ?? null,
  };
}

export function simulationBudgetCutoff(now: Date): string {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - BUDGET_RETENTION_DAYS);
  return cutoff.toISOString().slice(0, 10);
}
