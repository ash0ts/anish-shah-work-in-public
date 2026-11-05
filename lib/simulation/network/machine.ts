import { assign, setup } from "xstate";
import {
  battleStep,
  startBattle,
  PROGRAMS,
  CUSTOM_TICKS,
  type Battle,
  type BattleAction,
  type Encounter,
  type Program,
} from "./battle";
import type { CharacterId } from "./characters";
type Context = {
  character: CharacterId;
  position: { x: number; y: number };
  battle: Battle | null;
  selected: string[];
  discoveries: string[];
  completed: Encounter[];
  equipped: Array<{ program: Program; discoveryId: string | null }>;
};
type Event =
  | { type: "WALK"; x: number; y: number }
  | { type: "MEET"; character: CharacterId }
  | { type: "INSPECT"; id: string }
  | { type: "FOLDER" }
  | { type: "CUSTOM" }
  | { type: "EXIT_BATTLE" }
  | { type: "CHAT" }
  | { type: "JOURNAL" }
  | { type: "CLOSE" }
  | { type: "PAUSE" }
  | { type: "ENCOUNTER"; encounter: Encounter }
  | { type: "BATTLE"; action: BattleAction }
  | {
      type: "EQUIP";
      index: number;
      program: Program;
      discoveryId: string | null;
    }
  | {
      type: "RESTORE";
      discoveries: string[];
      completed: Encounter[];
      equipped: Context["equipped"];
    };
export const networkMachine = setup({
  types: {} as { context: Context; events: Event },
  actions: {
    cancelCharge: assign(({ context }) => ({
      battle: context.battle
        ? { ...context.battle, charging: false, charge: 0 }
        : null,
    })),
    exitBattle: assign({ battle: null }),
    walk: assign(({ context, event }) =>
      event.type === "WALK"
        ? {
            position: {
              x: Math.max(0, Math.min(8, Math.round(event.x))),
              y: Math.max(0, Math.min(8, Math.round(event.y))),
            },
          }
        : context,
    ),
    meet: assign(({ event }) =>
      event.type === "MEET" ? { character: event.character } : {},
    ),
    inspect: assign(({ context, event }) =>
      event.type === "INSPECT"
        ? {
            selected: [
              ...context.selected.filter((id) => id !== event.id),
              event.id,
            ].slice(-2),
            discoveries: [...new Set([...context.discoveries, event.id])].slice(
              -48,
            ),
          }
        : {},
    ),
    equip: assign(({ context, event }) =>
      event.type === "EQUIP" && event.index >= 0 && event.index < 6
        ? {
            equipped: context.equipped.map((slot, i) =>
              i === event.index
                ? { program: event.program, discoveryId: event.discoveryId }
                : slot,
            ),
          }
        : {},
    ),
    encounter: assign(({ event }) =>
      event.type === "ENCOUNTER"
        ? { battle: startBattle(event.encounter) }
        : {},
    ),
    battle: assign(({ context, event }) => {
      if (event.type !== "BATTLE" || !context.battle) return {};
      const battle = battleStep(context.battle, event.action);
      return {
        battle,
        completed:
          battle.outcome === "won"
            ? [...new Set([...context.completed, battle.encounter])]
            : context.completed,
      };
    }),
    restore: assign(({ event }) =>
      event.type === "RESTORE"
        ? {
            discoveries: event.discoveries,
            completed: event.completed,
            equipped: event.equipped,
          }
        : {},
    ),
  },
}).createMachine({
  id: "network",
  initial: "exploring",
  context: {
    character: "4n1sh",
    position: { x: 4, y: 4 },
    battle: null,
    selected: [],
    discoveries: [],
    completed: [],
    equipped: PROGRAMS.map((program) => ({ program, discoveryId: null })),
  },
  on: {
    CLOSE: [
      {
        guard: ({ context }) => context.battle?.outcome === "active",
        target: ".battling",
      },
      { target: ".exploring" },
    ],
    MEET: { actions: "meet" },
    EQUIP: { actions: "equip" },
    RESTORE: { actions: "restore" },
    ENCOUNTER: { target: ".custom", actions: "encounter" },
    CUSTOM: {
      guard: ({ context }) =>
        context.battle?.outcome === "active" &&
        context.battle.custom >= CUSTOM_TICKS,
      target: ".custom",
      actions: "cancelCharge",
    },
    EXIT_BATTLE: { target: ".exploring", actions: "exitBattle" },
    FOLDER: { target: ".folder", actions: "cancelCharge" },
    CHAT: { target: ".dialogue", actions: "cancelCharge" },
    JOURNAL: { target: ".journal", actions: "cancelCharge" },
    PAUSE: { target: ".paused", actions: "cancelCharge" },
    INSPECT: { target: ".detail", actions: "inspect" },
  },
  states: {
    custom: {
      on: {
        BATTLE: {
          guard: ({ event }) => event.action.type === "load",
          actions: "battle",
        },
      },
    },
    exploring: { on: { WALK: { actions: "walk" } } },
    battling: { on: { BATTLE: { actions: "battle" } } },
    folder: {
      on: {
        CLOSE: [
          {
            guard: ({ context }) => context.battle?.outcome === "active",
            target: "battling",
          },
          { target: "exploring" },
        ],
      },
    },
    dialogue: {},
    journal: {},
    detail: {},
    paused: {
      on: {
        CLOSE: [
          {
            guard: ({ context }) => context.battle?.outcome === "active",
            target: "battling",
          },
          { target: "exploring" },
        ],
      },
    },
  },
});
