import { assign, setup } from "xstate";
import type {
  ArenaProgress,
  CuriosityVector,
  ModelTurnOutput,
  SimulationDifficulty,
  SimulationDossier,
  SimulationMode,
  SimulationSceneId,
  SimulationTurnResponse,
  VisitorSignal,
} from "../types";

export type CampaignStateName =
  | "boot"
  | "act1Wave"
  | "act1Debrief"
  | "act2Wave"
  | "act2Debrief"
  | "act3Wave"
  | "act3Debrief"
  | "bossWave"
  | "bossDebrief"
  | "ending";

export type CampaignContext = {
  dossier: SimulationDossier;
  mode: SimulationMode;
  difficulty: SimulationDifficulty;
  curiosity: CuriosityVector;
  revision: number;
  pendingTurns: number;
  lastOpponent: ModelTurnOutput | null;
  responseSource: "generated" | "fixture" | "authored_fallback" | null;
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

export type CampaignEvent =
  | {
      type: "START";
      mode: SimulationMode;
      difficulty: SimulationDifficulty;
      curiosity: CuriosityVector;
    }
  | { type: "SESSION_READY"; revision: number }
  | { type: "WAVE_COMPLETE"; progress: ArenaProgress }
  | { type: "ADVANCE"; sceneId: SimulationSceneId; actionId: string }
  | { type: "TURN_REQUESTED" }
  | { type: "TURN_RESOLVED"; response: SimulationTurnResponse }
  | { type: "RESET" };

function initialCampaignContext(dossier: SimulationDossier): CampaignContext {
  return {
    dossier,
    mode: "tactical",
    difficulty: "standard",
    curiosity: "systems",
    revision: 0,
    pendingTurns: 0,
    lastOpponent: null,
    responseSource: null,
    revealedFactIds: [],
    visitorSignals: [],
    selectedDoorway: null,
    scores: {
      signalFound: 0,
      claimsGrounded: 0,
      curiosityFollowed: 0,
    },
    recalibrations: 0,
  };
}

export const campaignMachine = setup({
  types: {
    context: {} as CampaignContext,
    events: {} as CampaignEvent,
    input: {} as { dossier: SimulationDossier },
  },
  actions: {
    recordWave: assign({
      scores: ({ context, event }) =>
        event.type === "WAVE_COMPLETE"
          ? {
              ...context.scores,
              signalFound:
                context.scores.signalFound + event.progress.signalsFound,
            }
          : context.scores,
      recalibrations: ({ context, event }) =>
        event.type === "WAVE_COMPLETE"
          ? context.recalibrations + event.progress.recalibrations
          : context.recalibrations,
    }),
    recordChoice: assign({
      selectedDoorway: ({ context, event }) =>
        event.type === "ADVANCE" && event.sceneId === "act-3"
          ? event.actionId
          : context.selectedDoorway,
      scores: ({ context }) => ({
        ...context.scores,
        curiosityFollowed: context.scores.curiosityFollowed + 1,
      }),
    }),
  },
}).createMachine({
  id: "meet-me-4n1sh",
  initial: "boot",
  context: ({ input }) => initialCampaignContext(input.dossier),
  on: {
    SESSION_READY: {
      actions: assign({
        revision: ({ context, event }) =>
          Math.max(context.revision, event.revision),
      }),
    },
    TURN_REQUESTED: {
      actions: assign({
        pendingTurns: ({ context }) => context.pendingTurns + 1,
      }),
    },
    TURN_RESOLVED: {
      actions: assign({
        revision: ({ event }) => event.response.revision,
        pendingTurns: ({ context }) => Math.max(0, context.pendingTurns - 1),
        lastOpponent: ({ event }) => event.response.opponent,
        responseSource: ({ event }) => event.response.source,
        revealedFactIds: ({ context, event }) => [
          ...new Set([
            ...context.revealedFactIds,
            ...event.response.factCards.map((fact) => fact.id),
          ]),
        ],
        visitorSignals: ({ context, event }) => [
          ...new Set([
            ...context.visitorSignals,
            ...event.response.opponent.visitorSignals,
          ]),
        ],
        scores: ({ context, event }) => ({
          ...context.scores,
          claimsGrounded:
            context.scores.claimsGrounded + event.response.factCards.length,
          curiosityFollowed:
            context.scores.curiosityFollowed +
            Number(event.response.opponent.visitorSignals.length > 0),
        }),
      }),
    },
    RESET: {
      target: ".boot",
      actions: assign(({ context }) => initialCampaignContext(context.dossier)),
    },
  },
  states: {
    boot: {
      on: {
        START: {
          target: "act1Wave",
          actions: assign({
            mode: ({ event }) => event.mode,
            difficulty: ({ event }) => event.difficulty,
            curiosity: ({ event }) => event.curiosity,
          }),
        },
      },
    },
    act1Wave: {
      on: {
        WAVE_COMPLETE: {
          target: "act1Debrief",
          actions: "recordWave",
        },
      },
    },
    act1Debrief: {
      on: { ADVANCE: { target: "act2Wave", actions: "recordChoice" } },
    },
    act2Wave: {
      on: {
        WAVE_COMPLETE: {
          target: "act2Debrief",
          actions: "recordWave",
        },
      },
    },
    act2Debrief: {
      on: { ADVANCE: { target: "act3Wave", actions: "recordChoice" } },
    },
    act3Wave: {
      on: {
        WAVE_COMPLETE: {
          target: "act3Debrief",
          actions: "recordWave",
        },
      },
    },
    act3Debrief: {
      on: { ADVANCE: { target: "bossWave", actions: "recordChoice" } },
    },
    bossWave: {
      on: {
        WAVE_COMPLETE: {
          target: "bossDebrief",
          actions: "recordWave",
        },
      },
    },
    bossDebrief: {
      on: { ADVANCE: { target: "ending", actions: "recordChoice" } },
    },
    ending: {},
  },
});

export const CAMPAIGN_STATE_ORDER: readonly CampaignStateName[] = [
  "boot",
  "act1Wave",
  "act1Debrief",
  "act2Wave",
  "act2Debrief",
  "act3Wave",
  "act3Debrief",
  "bossWave",
  "bossDebrief",
  "ending",
];

const SCENE_BY_STATE: Partial<Record<CampaignStateName, SimulationSceneId>> = {
  act1Wave: "act-1",
  act1Debrief: "act-1",
  act2Wave: "act-2",
  act2Debrief: "act-2",
  act3Wave: "act-3",
  act3Debrief: "act-3",
  bossWave: "boss",
  bossDebrief: "boss",
};

export function campaignSceneId(
  state: CampaignStateName,
): SimulationSceneId | null {
  return SCENE_BY_STATE[state] ?? null;
}

export function campaignStageKind(
  state: CampaignStateName,
): "boot" | "wave" | "debrief" | "ending" {
  if (state === "boot" || state === "ending") return state;
  return state.endsWith("Wave") ? "wave" : "debrief";
}

export function campaignProgressIndex(state: CampaignStateName): number {
  return Math.max(0, CAMPAIGN_STATE_ORDER.indexOf(state));
}
