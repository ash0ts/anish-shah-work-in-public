import { runtimeValue } from "../runtime-env";

export type SimulationExperienceMode =
  | "disabled"
  | "coming-soon"
  | "campaign-v1";

export function simulationExperienceMode(): SimulationExperienceMode {
  const configured = runtimeValue("SIMULATION_EXPERIENCE_MODE");
  if (configured === "campaign-v1") return "campaign-v1";
  if (configured === "coming-soon") return "coming-soon";
  if (configured === "disabled") return "disabled";
  const localDevelopment =
    runtimeValue("NODE_ENV") === "development" &&
    runtimeValue("DEPLOYMENT_TIER") === undefined;
  return localDevelopment ? "campaign-v1" : "disabled";
}

/** The complete campaign and its session APIs are available. */
export function simulationExperienceEnabled(): boolean {
  return simulationExperienceMode() === "campaign-v1";
}

/** The public route and room ingress are available. */
export function simulationExperienceVisible(): boolean {
  return simulationExperienceMode() !== "disabled";
}
