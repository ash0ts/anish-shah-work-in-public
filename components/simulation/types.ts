export type SimulationMode = "action" | "tactical";

export type SimulationDifficulty = "story" | "standard" | "expert";

export type CuriosityVector =
  | "systems"
  | "research"
  | "teaching"
  | "surprise";

export type SimulationSceneId = "act-1" | "act-2" | "act-3" | "boss";

export type SimulationResponseMode =
  | "counter"
  | "probe"
  | "acknowledge"
  | "redirect";

export type VisitorSignal =
  | "evaluation-rigor"
  | "systems-thinking"
  | "teaching"
  | "open-source"
  | "community"
  | "playful-curiosity";

export type SimulationFact = {
  id: string;
  subjectIds: string[];
  title: string;
  allowedStatement: string;
  qualifier: string | null;
  publicEvidenceIds: string[];
  href: string | null;
  bucket: string;
  roleSummary: string;
};

export type SimulationMetric = {
  id: string;
  displayValue: string;
  label: string;
  qualifier: string | null;
  periodLabel: string;
  sourceLabel: string;
};

export type SimulationProviderDoorway = {
  provider:
    | "myanimelist"
    | "hardcover"
    | "spotify"
    | "discogs"
    | "steam"
    | "strava";
  label: string;
  route: string;
};

export type SimulationScene = {
  id: SimulationSceneId;
  title: string;
  encounter: string;
  candidateFactIds: string[];
  allowedActionIds: string[];
  fallbackDialogueIds: string[];
  allowsFreeText: boolean;
};

export type ModelTurnOutput = {
  opponentLine: string;
  responseMode: SimulationResponseMode;
  revealEntityIds: string[];
  visitorSignals: VisitorSignal[];
};

export type SimulationDossier = {
  schemaVersion: "1.0";
  campaignVersion: string;
  contentVersion: string;
  generatedAt: string;
  publicationSource: "published_snapshot" | "static_fallback";
  persona: {
    displayName: "4N1SH";
    accessibleName: "Anish simulation";
    disclosure: string;
  };
  facts: SimulationFact[];
  metrics: SimulationMetric[];
  scenes: SimulationScene[];
  providerDoorways: SimulationProviderDoorway[];
  fallbackDialogue: Array<ModelTurnOutput & { id: string }>;
};

export type SimulationTurnRequest = {
  requestId: string;
  revision: number;
  sceneId: SimulationSceneId;
  actionId: string;
  freeText?: string;
};

export type SimulationTurnResponse = {
  revision: number;
  source: "generated" | "fixture" | "authored_fallback";
  opponent: ModelTurnOutput;
  factCards: Array<{
    id: string;
    statement: string;
    qualifier: string | null;
    href: string | null;
    evidenceIds: string[];
  }>;
  nextActions: Array<{ id: string; sceneId: SimulationSceneId }>;
  session?: {
    revision: number;
    sceneId: SimulationSceneId | "complete";
    remainingFreeTextTurns: number;
    remainingGeneratedBeats: number;
  };
};

export type ArenaProgress = {
  context: number;
  signalsFound: number;
  elapsedSeconds: number;
  recalibrations: number;
};

export type EncounterDefinition = {
  sceneId: SimulationSceneId;
  actLabel: string;
  arenaLabel: string;
  threatWords: string[];
  signalGlyphs: string[];
  tacticalHazards: Array<[number, number]>;
};

export const ENCOUNTERS: Record<SimulationSceneId, EncounterDefinition> = {
  "act-1": {
    sceneId: "act-1",
    actLabel: "Act I",
    arenaLabel: "Escape the Labels",
    threatWords: ["EVANGELIST", "MARKETER", "PROMPT GUY", "ONE THING"],
    signalGlyphs: ["REPO", "COURSE", "ARTICLE", "TALK"],
    tacticalHazards: [
      [0, 3],
      [1, 1],
      [2, 4],
      [3, 0],
      [4, 2],
    ],
  },
  "act-2": {
    sceneId: "act-2",
    actLabel: "Act II",
    arenaLabel: "Challenge the Model",
    threatWords: ["CAUSE", "PROOF?", "100%", "OBVIOUS"],
    signalGlyphs: ["TRACE", "SCOPE", "DATE", "SOURCE"],
    tacticalHazards: [
      [0, 1],
      [1, 4],
      [2, 2],
      [3, 0],
      [4, 3],
    ],
  },
  "act-3": {
    sceneId: "act-3",
    actLabel: "Act III",
    arenaLabel: "Build a Conversation Key",
    threatWords: ["TASTE = SELF", "PROFILED", "INFER", "CERTAIN"],
    signalGlyphs: ["WATCH", "READ", "LISTEN", "PLAY"],
    tacticalHazards: [
      [0, 4],
      [1, 2],
      [2, 0],
      [3, 3],
      [4, 1],
    ],
  },
  boss: {
    sceneId: "boss",
    actLabel: "Final encounter",
    arenaLabel: "The Approximation",
    threatWords: ["JUST ONE LABEL", "COMPRESS", "CONFIDENT", "OVERFIT"],
    signalGlyphs: ["GROUND", "QUALIFY", "CONNECT", "ASK"],
    tacticalHazards: [
      [0, 0],
      [0, 4],
      [2, 2],
      [4, 0],
      [4, 4],
    ],
  },
};
