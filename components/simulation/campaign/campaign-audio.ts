import type { CampaignStateName } from "./campaign-state";

export type ArenaFeedback = "hit" | "evidence" | "near-miss" | "recalibrate";

type CampaignAudioCue =
  | "simulation-boot"
  | "simulation-act-1"
  | "simulation-act-2"
  | "simulation-act-3"
  | "simulation-boss"
  | "simulation-ending";

type ArenaFeedbackAudioCue =
  | "simulation-hit"
  | "simulation-evidence"
  | "simulation-near-miss"
  | "simulation-recalibrate";

export function campaignAudioCueForState(
  state: CampaignStateName,
): CampaignAudioCue | null {
  if (state === "boot") return "simulation-boot";
  if (state === "act1Wave") return "simulation-act-1";
  if (state === "act2Wave") return "simulation-act-2";
  if (state === "act3Wave") return "simulation-act-3";
  if (state === "bossWave") return "simulation-boss";
  if (state === "ending") return "simulation-ending";
  return null;
}

export function arenaFeedbackAudioCue(
  kind: ArenaFeedback,
): ArenaFeedbackAudioCue {
  if (kind === "hit") return "simulation-hit";
  if (kind === "evidence") return "simulation-evidence";
  if (kind === "near-miss") return "simulation-near-miss";
  return "simulation-recalibrate";
}
