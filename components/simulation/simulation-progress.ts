import type {
  CuriosityVector,
  SimulationDifficulty,
  SimulationMode,
  VisitorSignal,
} from "./types";

export const SIMULATION_PROGRESS_KEY = "anish:simulation:campaign-v1";

export type SafeSimulationProgress = {
  campaignVersion: string;
  stateName: string;
  mode: SimulationMode;
  difficulty: SimulationDifficulty;
  curiosity: CuriosityVector;
  revision: number;
  revealedFactIds: string[];
  visitorSignals: VisitorSignal[];
  selectedDoorway: string | null;
  scores: {
    signalFound: number;
    claimsGrounded: number;
    curiosityFollowed: number;
  };
  recalibrations: number;
};

export function safeSimulationProgress(
  progress: SafeSimulationProgress,
): SafeSimulationProgress {
  return {
    campaignVersion: progress.campaignVersion,
    stateName: progress.stateName,
    mode: progress.mode,
    difficulty: progress.difficulty,
    curiosity: progress.curiosity,
    revision: progress.revision,
    revealedFactIds: [...progress.revealedFactIds],
    visitorSignals: [...progress.visitorSignals],
    selectedDoorway: progress.selectedDoorway,
    scores: { ...progress.scores },
    recalibrations: progress.recalibrations,
  };
}

export function writeSimulationProgress(progress: SafeSimulationProgress) {
  try {
    window.sessionStorage.setItem(
      SIMULATION_PROGRESS_KEY,
      JSON.stringify(safeSimulationProgress(progress)),
    );
  } catch {
    // Storage can be unavailable in hardened browsing modes. The server session
    // and in-memory campaign remain authoritative, so gameplay continues.
  }
}

export function clearSimulationProgress() {
  try {
    window.sessionStorage.removeItem(SIMULATION_PROGRESS_KEY);
  } catch {
    // Expiry and the HttpOnly server cookie still bound the session.
  }
}
