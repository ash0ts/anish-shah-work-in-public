import { runtimeDatabase } from "../runtime-env";
import {
  CONVERSATION_LIMITS,
  CONVERSATION_VERSION,
} from "@/lib/simulation/conversation-contract";
import { readSimulationUsageHealth } from "./budget-repository";
import { simulationExperienceMode } from "./mode";
import {
  GEMINI_MODEL,
  decryptGeminiKey,
  readGeminiConfiguration,
} from "./conversation/settings";
import { googlePermissionSummaries } from "./conversation/permissions";

export type SimulationHealthSummary = {
  campaignVersion: string;
  experienceMode: ReturnType<typeof simulationExperienceMode>;
  aiMode: "live" | "authored-only";
  provider: "google";
  model: string;
  configured: boolean;
  lastSuccessfulGenerationAt: string | null;
  dailyModelCalls: number | null;
  dailyModelLimit: number;
  fallbackRate: "none" | "low" | "elevated" | "high" | "unavailable";
  approvedProviders: string[];
};
export async function getSimulationHealthSummary(
  now = new Date(),
  database: D1Database | null = runtimeDatabase(),
): Promise<SimulationHealthSummary> {
  const summary: SimulationHealthSummary = {
    campaignVersion: CONVERSATION_VERSION,
    experienceMode: simulationExperienceMode(),
    aiMode: "authored-only",
    provider: "google",
    model: GEMINI_MODEL,
    configured: false,
    lastSuccessfulGenerationAt: null,
    dailyModelCalls: null,
    dailyModelLimit: CONVERSATION_LIMITS.dailyCalls,
    fallbackRate: "unavailable",
    approvedProviders: [],
  };
  if (!database) return summary;
  try {
    const [usage, config, approvals] = await Promise.all([
      readSimulationUsageHealth(database, now),
      readGeminiConfiguration(database),
      googlePermissionSummaries(database),
    ]);
    summary.configured =
      summary.experienceMode === "conversation-v2" &&
      config.tested &&
      config.enabled &&
      Boolean(await decryptGeminiKey(config));
    summary.aiMode = summary.configured ? "live" : "authored-only";
    summary.dailyModelCalls = usage.modelCalls;
    summary.lastSuccessfulGenerationAt = usage.lastSuccessfulGenerationAt;
    const rate =
      usage.authoredFallbacks /
      Math.max(1, usage.authoredFallbacks + usage.modelCalls);
    summary.fallbackRate = !rate
      ? "none"
      : rate < 0.1
        ? "low"
        : rate < 0.35
          ? "elevated"
          : "high";
    summary.approvedProviders = approvals
      .filter((approval) => approval.active)
      .map((approval) => approval.provider)
      .sort();
  } catch {
    /* Health contains configuration state only, never settings or provider errors. */
  }
  return summary;
}
export async function simulationProviderApprovalDigest(
  database: D1Database | null = runtimeDatabase(),
): Promise<string | null> {
  if (!database) return null;
  try {
    const safe = (await googlePermissionSummaries(database))
      .map(({ provider, enabled, active, approvedAt, expiresAt }) => ({
        provider,
        enabled,
        active,
        approvedAt,
        expiresAt,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider));
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(safe)),
      ),
    );
    return Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
}
