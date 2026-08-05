import { runtimeValue } from "../runtime-env";
import {
  simulationExperienceEnabled,
  simulationExperienceMode,
} from "./mode";

export type SimulationAiMode =
  | "fixture"
  | "live"
  | "authored-only"
  | "invalid";

export type SimulationAiTransport =
  | "gateway"
  | "direct-local"
  | "invalid";

export type SimulationRuntimeConfiguration = {
  experienceMode: ReturnType<typeof simulationExperienceMode>;
  aiMode: SimulationAiMode;
  aiTransport: SimulationAiTransport;
  provider: "anthropic";
  model: string;
  configured: boolean;
  dailyModelLimit: number;
  hosted: boolean;
};

function isHostedTier(tier: string | undefined): boolean {
  return tier === "preview" || tier === "staging" || tier === "production";
}

function isExactLoopbackOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.port === "3000" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

export function simulationAiTransport(): SimulationAiTransport {
  const configured = runtimeValue("SIMULATION_AI_TRANSPORT") ?? "gateway";
  const tier = runtimeValue("DEPLOYMENT_TIER");
  const hosted = isHostedTier(tier);
  if (configured === "gateway") return "gateway";
  if (configured === "direct-local") {
    return !hosted &&
      runtimeValue("NODE_ENV") !== "production" &&
      isExactLoopbackOrigin(runtimeValue("SITE_URL"))
      ? "direct-local"
      : "invalid";
  }
  return "invalid";
}

export function simulationAiMode(): SimulationAiMode {
  const configured = runtimeValue("SIMULATION_AI_MODE");
  const tier = runtimeValue("DEPLOYMENT_TIER");
  const hosted = isHostedTier(tier);
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
  const hosted = isHostedTier(tier);
  const aiMode = simulationAiMode();
  const aiTransport = simulationAiTransport();
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
  const directLocalKey = runtimeValue("SIMULATION_LOCAL_ANTHROPIC_API_KEY") ?? "";
  const directLocalReady = Boolean(
    aiTransport === "direct-local" &&
      directLocalKey.length >= 20 &&
      directLocalKey.length <= 1_024 &&
      !/[\s\u0000-\u001f\u007f]/.test(directLocalKey),
  );
  const liveTransportReady =
    aiTransport === "gateway"
      ? gatewayReady
      : aiTransport === "direct-local"
        ? directLocalReady
        : false;
  const configured = Boolean(
    simulationExperienceEnabled() &&
      aiMode !== "invalid" &&
      provider === "anthropic" &&
      validModel &&
      (aiMode !== "live" || liveTransportReady),
  );
  return {
    experienceMode: simulationExperienceMode(),
    aiMode,
    aiTransport,
    provider: "anthropic",
    model,
    configured,
    dailyModelLimit: simulationDailyModelLimit(),
    hosted,
  };
}
