export const SIMULATION_CAMPAIGN_VERSION = "1.0" as const;

export const SIMULATION_MODES = ["action", "tactical"] as const;
export type SimulationMode = (typeof SIMULATION_MODES)[number];

export const SIMULATION_DIFFICULTIES = [
  "story",
  "standard",
  "expert",
] as const;
export type SimulationDifficulty = (typeof SIMULATION_DIFFICULTIES)[number];

export const SIMULATION_CURIOSITIES = [
  "systems",
  "research",
  "teaching",
  "surprise",
] as const;
export type SimulationCuriosity = (typeof SIMULATION_CURIOSITIES)[number];

export const SIMULATION_SCENE_IDS = [
  "act-1",
  "act-2",
  "act-3",
  "boss",
  "complete",
] as const;
export type SimulationSceneId = (typeof SIMULATION_SCENE_IDS)[number];

export const SIMULATION_VISITOR_SIGNALS = [
  "evaluation-rigor",
  "systems-thinking",
  "teaching",
  "open-source",
  "community",
  "playful-curiosity",
] as const;
export type SimulationVisitorSignal =
  (typeof SIMULATION_VISITOR_SIGNALS)[number];

export const SIMULATION_RESPONSE_MODES = [
  "counter",
  "probe",
  "acknowledge",
  "redirect",
] as const;
export type SimulationResponseMode =
  (typeof SIMULATION_RESPONSE_MODES)[number];

export type SimulationScore = {
  signalFound: number;
  claimsGrounded: number;
  curiosityFollowed: number;
};

export type SimulationSafeState = {
  mode: SimulationMode;
  difficulty: SimulationDifficulty;
  curiosity: SimulationCuriosity;
  score: SimulationScore;
  visitorSignals: SimulationVisitorSignal[];
  revealedEntityIds: string[];
  selectedPlayRoute: string | null;
};

export type SimulationSessionPublic = {
  campaignVersion: typeof SIMULATION_CAMPAIGN_VERSION;
  status: "active" | "complete";
  revision: number;
  sceneId: SimulationSceneId;
  state: SimulationSafeState;
  remainingFreeTextTurns: number;
  remainingGeneratedBeats: number;
  expiresAt: string;
};

export type CreateSimulationSessionInput = {
  mode: SimulationMode;
  difficulty: SimulationDifficulty;
  curiosity: SimulationCuriosity;
};

export type SimulationTurnRequest = {
  requestId: string;
  revision: number;
  sceneId: Exclude<SimulationSceneId, "complete">;
  actionId: string;
  freeText?: string;
};

export type ModelTurnOutput = {
  opponentLine: string;
  responseMode: SimulationResponseMode;
  revealEntityIds: string[];
  visitorSignals: SimulationVisitorSignal[];
};

export type TrustedFactCard = {
  id: string;
  statement: string;
  qualifier: string | null;
  href: string | null;
  evidenceIds: string[];
};

export type TrustedAction = {
  id: string;
  sceneId: Exclude<SimulationSceneId, "complete">;
};

export type SimulationTurnResponse = {
  revision: number;
  source: "generated" | "fixture" | "authored_fallback";
  opponent: ModelTurnOutput;
  factCards: TrustedFactCard[];
  nextActions: TrustedAction[];
  session: SimulationSessionPublic;
};

export type PlayProvider =
  | "myanimelist"
  | "hardcover"
  | "spotify"
  | "discogs"
  | "steam"
  | "strava";

export type SimulationProviderApproval = {
  provider: PlayProvider;
  scopes: Array<"game_display" | "llm_context">;
  reference: string;
  approvedAt: string;
  expiresAt: string | null;
  enabled: boolean;
};

export type SimulationPlayGroundingSummary = {
  provider: PlayProvider;
  source: "current_public_snapshot" | "current_public_config";
  facets: string[];
  items: Array<{
    title: string;
    descriptors: string[];
  }>;
};

export type GroundedTurnInput = {
  sceneId: Exclude<SimulationSceneId, "complete">;
  actionId: string;
  freeText?: string;
  facts: TrustedFactCard[];
  allowedEntityIds: string[];
  visitorSignals: SimulationVisitorSignal[];
  curiosity: SimulationCuriosity;
  providerGrounding: {
    provider: PlayProvider;
    label: string;
    approvedForModel: boolean;
    summary: SimulationPlayGroundingSummary | null;
  } | null;
};

export interface SimulationDialogueProvider {
  readonly source: "generated" | "fixture";
  generateTurn(input: GroundedTurnInput): Promise<unknown>;
}
