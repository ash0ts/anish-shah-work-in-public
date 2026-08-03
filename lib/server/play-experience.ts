import { runtimeValue } from "./runtime-env";

export type PlayExperienceMode = "classic" | "my-room-2001";

export function parsePlayExperienceMode(
  value: string | null | undefined,
): PlayExperienceMode {
  return value === "my-room-2001" ? "my-room-2001" : "classic";
}

export function playExperienceMode(): PlayExperienceMode {
  return parsePlayExperienceMode(runtimeValue("PLAY_EXPERIENCE_MODE"));
}

export function roomExperienceEnabled(): boolean {
  return playExperienceMode() === "my-room-2001";
}
