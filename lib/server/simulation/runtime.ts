import { runtimeValue } from "../runtime-env";
import {
  simulationExperienceEnabled,
  simulationExperienceMode,
} from "./policy";

export type SimulationAiMode =
  | "fixture"
  | "live"
  | "authored-only"
  | "invalid";

export type SimulationRuntimeConfiguration = {
  experienceMode: ReturnType<typeof simulationExperienceMode>;
  aiMode: SimulationAiMode;
  provider: "anthropic";
  model: string;
  configured: boolean;
  dailyModelLimit: number;
  hosted: boolean;
};

export function simulationAiMode(): SimulationAiMode {
  const configured = runtimeValue("SIMULATION_AI_MODE");
  const tier = runtimeValue("DEPLOYMENT_TIER");
  const hosted = tier === "preview" || tier === "staging" || tier === "production";
  if (configured === "fixture") return hosted ? "invalid" : "fixture";
  if (configured === "live" || configured === "authored-only") {
    return configured;
  }
  return hosted ? "authored-only" : "fixture";
}

export function simulationDailyModelLimit(): number {
  const raw = runtimeValue("SIMULATION_DAILY_MODEL_LIMIT");
  if (!raw || !/^\d{1,6}$/.test(raw)) return 500;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100_000
    ? value
    : 500;
}

export function simulationRuntimeConfiguration(): SimulationRuntimeConfiguration {
  const tier = runtimeValue("DEPLOYMENT_TIER");
  const hosted = tier === "preview" || tier === "staging" || tier === "production";
  const aiMode = simulationAiMode();
  const provider = runtimeValue("SIMULATION_PROVIDER") ?? "anthropic";
  const model = runtimeValue("SIMULATION_MODEL") ?? "claude-sonnet-5";
  const gatewayReady = Boolean(
    /^[a-f0-9]{32}$/i.test(runtimeValue("SIMULATION_GATEWAY_ACCOUNT_ID") ?? "") &&
      /^[a-z0-9][a-z0-9_-]{0,63}$/.test(
        runtimeValue("SIMULATION_GATEWAY_ID") ?? "",
      ) &&
      (runtimeValue("SIMULATION_GATEWAY_TOKEN")?.length ?? 0) >= 20 &&
      /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(
        runtimeValue("SIMULATION_GATEWAY_BYOK_ALIAS") ?? "",
      ),
  );
  const validModel = /^claude-[a-z0-9.-]{1,80}$/i.test(model);
  const configured = Boolean(
    simulationExperienceEnabled() &&
      aiMode !== "invalid" &&
      provider === "anthropic" &&
      validModel &&
      (aiMode !== "live" || gatewayReady),
  );
  return {
    experienceMode: simulationExperienceMode(),
    aiMode,
    provider: "anthropic",
    model,
    configured,
    dailyModelLimit: simulationDailyModelLimit(),
    hosted,
  };
}
