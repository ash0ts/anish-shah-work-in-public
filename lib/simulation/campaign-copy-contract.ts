export const SIMULATION_ACTION_COPY_IDS = [
  "trace-the-system",
  "follow-the-people",
  "inspect-the-artifact",
  "probe",
  "trace",
  "qualify",
  "reframe",
  "watch",
  "read",
  "listen",
  "collect",
  "play",
  "move",
  "ground-the-claim",
  "keep-the-qualifier",
  "connect-the-facets",
] as const;

export const SIMULATION_CURIOSITY_COPY_IDS = [
  "systems",
  "research",
  "teaching",
  "surprise",
] as const;

export type SimulationActionCopyId =
  (typeof SIMULATION_ACTION_COPY_IDS)[number];
export type SimulationCuriosityCopyId =
  (typeof SIMULATION_CURIOSITY_COPY_IDS)[number];
