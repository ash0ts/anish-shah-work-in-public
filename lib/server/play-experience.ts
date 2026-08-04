import { runtimeValue } from "./runtime-env";

export type PlayExperienceMode = "classic" | "my-room-2001";
export type TravelAtlasMode = "disabled" | "atlas-v1";

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

export function parseTravelAtlasMode(
  value: string | null | undefined,
): TravelAtlasMode {
  return value === "atlas-v1" ? "atlas-v1" : "disabled";
}

export function travelAtlasMode(): TravelAtlasMode {
  return parseTravelAtlasMode(runtimeValue("TRAVEL_ATLAS_MODE"));
}

export function travelAtlasEnabled(): boolean {
  return roomExperienceEnabled() && travelAtlasMode() === "atlas-v1";
}
