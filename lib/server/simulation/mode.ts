import { runtimeValue } from "../runtime-env";
export type SimulationExperienceMode = "disabled" | "conversation-v2";
export function simulationExperienceMode(): SimulationExperienceMode {
  if (runtimeValue("DEPLOYMENT_TIER") === "production") return "disabled";
  return runtimeValue("SIMULATION_EXPERIENCE_MODE") === "conversation-v2"
    ? "conversation-v2"
    : "disabled";
}
export function simulationExperienceEnabled() {
  return simulationExperienceMode() === "conversation-v2";
}
export const simulationExperienceVisible = simulationExperienceEnabled;
