import { runtimeDatabase } from "../runtime-env";
import { listSimulationProviderApprovals } from "./approvals";
import { simulationManifest } from "./policy";
import { simulationRuntimeConfiguration } from "./runtime";

export type SimulationHealthSummary = {
  campaignVersion: string;
  experienceMode: "disabled" | "campaign-v1";
  aiMode: "fixture" | "live" | "authored-only" | "invalid";
  provider: "anthropic";
  model: string;
  configured: boolean;
  lastSuccessfulGenerationAt: string | null;
  dailyModelCalls: number | null;
  dailyModelLimit: number;
  fallbackRate: "none" | "low" | "elevated" | "high" | "unavailable";
  approvedProviders: string[];
};

type BudgetRow = { modelCalls: number; authoredFallbacks: number };
type MaintenanceRow = { checkedAt: string };

function coarseFallbackRate(
  modelCalls: number,
  fallbacks: number,
): SimulationHealthSummary["fallbackRate"] {
  const total = modelCalls + fallbacks;
  if (total === 0 || fallbacks === 0) return "none";
  const rate = fallbacks / total;
  if (rate < 0.1) return "low";
  if (rate < 0.35) return "elevated";
  return "high";
}

export async function getSimulationHealthSummary(
  now = new Date(),
  database: D1Database | null = runtimeDatabase(),
): Promise<SimulationHealthSummary> {
  const runtime = simulationRuntimeConfiguration();
  let lastSuccessfulGenerationAt: string | null = null;
  let dailyModelCalls: number | null = null;
  let fallbackRate: SimulationHealthSummary["fallbackRate"] = "unavailable";
  let approvedProviders: string[] = [];
  if (database) {
    try {
      const [budget, maintenance, approvals] = await Promise.all([
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
        listSimulationProviderApprovals(database),
      ]);
      dailyModelCalls = Number(budget?.modelCalls ?? 0);
      fallbackRate = coarseFallbackRate(
        dailyModelCalls,
        Number(budget?.authoredFallbacks ?? 0),
      );
      lastSuccessfulGenerationAt = maintenance?.checkedAt ?? null;
      approvedProviders = approvals
        .filter(
          (approval) =>
            approval.enabled &&
            approval.scopes.includes("game_display") &&
            approval.scopes.includes("llm_context") &&
            (!approval.expiresAt || Date.parse(approval.expiresAt) > now.getTime()),
        )
        .map((approval) => approval.provider)
        .sort();
    } catch {
      // Keep the owner health response available without exposing a database error.
    }
  }
  return {
    campaignVersion: simulationManifest.campaignVersion,
    experienceMode: runtime.experienceMode,
    aiMode: runtime.aiMode,
    provider: runtime.provider,
    model: runtime.model,
    configured: runtime.configured && Boolean(database),
    lastSuccessfulGenerationAt,
    dailyModelCalls,
    dailyModelLimit: runtime.dailyModelLimit,
    fallbackRate,
    approvedProviders,
  };
}

export async function simulationProviderApprovalDigest(
  database: D1Database | null = runtimeDatabase(),
): Promise<string | null> {
  if (!database) return null;
  try {
    const approvals = await listSimulationProviderApprovals(database);
    const safeProjection = approvals
      .map(({ provider, scopes, approvedAt, expiresAt, enabled }) => ({
        provider,
        scopes: [...scopes].sort(),
        approvedAt,
        expiresAt,
        enabled,
      }))
      .sort((left, right) => left.provider.localeCompare(right.provider));
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(safeProjection)),
      ),
    );
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return null;
  }
}
