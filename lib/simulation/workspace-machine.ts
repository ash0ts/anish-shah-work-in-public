import { assign, setup } from "xstate";
import {
  authoredReply,
  connectObjects,
  type InternetObject,
  type DocumentedConnection,
  type DemoReply,
} from "./personal-internet";

export type WorkspacePanel = "explore" | "chat" | "journal";
type Context = {
  catalog: InternetObject[];
  openIds: string[];
  selectedIds: string[];
  readers: [string | null, string | null];
  journalIds: string[];
  connection: DocumentedConnection | null;
  panel: WorkspacePanel;
  trail: boolean;
  opened: boolean;
  connected: boolean;
  investigated: boolean;
  messages: Array<DemoReply & { question: string }>;
};
export type WorkspaceEvent =
  | { type: "OPEN" | "SELECT" | "CLOSE"; id: string }
  | { type: "LOAD"; id: string; reader: 0 | 1 }
  | { type: "EJECT"; reader: 0 | 1 }
  | { type: "CONNECT" }
  | { type: "ASK"; ids: string[] }
  | { type: "SEND"; question: string }
  | { type: "PANEL"; panel: WorkspacePanel }
  | { type: "TRAIL" }
  | { type: "RESTORE"; openIds: string[]; panel: WorkspacePanel };
const validIds = (catalog: InternetObject[], ids: string[]) =>
  [...new Set(ids)].filter((id) => catalog.some((object) => object.id === id));

export const workspaceMachine = setup({
  types: {
    context: {} as Context,
    events: {} as WorkspaceEvent,
    input: {} as { catalog: InternetObject[] },
  },
}).createMachine({
  id: "personal-internet",
  initial: "exploring",
  context: ({ input }) => ({
    catalog: input.catalog,
    openIds: [],
    selectedIds: [],
    readers: [null, null],
    journalIds: [],
    connection: null,
    panel: "explore",
    trail: false,
    opened: false,
    connected: false,
    investigated: false,
    messages: [],
  }),
  states: {
    exploring: {},
    inspecting: {},
    connecting: {},
    conversing: {},
    journaling: {},
  },
  on: {
    LOAD: {
      target: ".inspecting",
      actions: assign(({ context, event }) => {
        if (!context.catalog.some((object) => object.id === event.id))
          return {};
        const readers: Context["readers"] = [...context.readers];
        const other = event.reader === 0 ? 1 : 0;
        if (readers[other] === event.id) readers[other] = null;
        readers[event.reader] = event.id;
        return {
          readers,
          selectedIds: readers.filter((id): id is string => !!id),
          connection: null,
          opened: true,
          panel: "explore" as const,
          journalIds: validIds(context.catalog, [
            ...context.journalIds,
            event.id,
          ]),
        };
      }),
    },
    EJECT: {
      target: ".exploring",
      actions: assign(({ context, event }) => {
        const readers: Context["readers"] = [...context.readers];
        readers[event.reader] = null;
        return {
          readers,
          selectedIds: readers.filter((id): id is string => !!id),
          connection: null,
        };
      }),
    },
    OPEN: {
      target: ".inspecting",
      actions: assign(({ context, event }) => {
        if (!context.catalog.some((object) => object.id === event.id))
          return {};
        return {
          openIds: [
            ...context.openIds.filter((id) => id !== event.id),
            event.id,
          ].slice(-2),
          journalIds: validIds(context.catalog, [
            ...context.journalIds,
            event.id,
          ]),
          opened: true,
          panel: "explore" as const,
        };
      }),
    },
    CLOSE: {
      actions: assign(({ context, event }) => ({
        openIds: context.openIds.filter((id) => id !== event.id),
      })),
    },
    SELECT: {
      target: ".connecting",
      actions: assign(({ context, event }) => {
        const loadedIds = context.readers.filter((id): id is string => !!id);
        const selectedIds = loadedIds.includes(event.id)
          ? loadedIds.filter((id) => id !== event.id)
          : validIds(context.catalog, [...loadedIds, event.id]).slice(-2);
        return {
          selectedIds,
          readers: [
            selectedIds[0] ?? null,
            selectedIds[1] ?? null,
          ] as Context["readers"],
          connection: null,
        };
      }),
    },
    CONNECT: {
      target: ".connecting",
      actions: assign(({ context }) => {
        const pair = context.readers.flatMap(
          (id) => context.catalog.find((object) => object.id === id) ?? [],
        );
        if (pair.length !== 2) return {};
        const connection = connectObjects(pair[0], pair[1]);
        return {
          connection,
          connected: context.connected || connection.supported,
          journalIds: validIds(context.catalog, [
            ...context.journalIds,
            ...connection.ids,
          ]),
        };
      }),
    },
    ASK: {
      target: ".conversing",
      actions: assign(({ context, event }) => ({
        selectedIds: validIds(context.catalog, event.ids).slice(0, 2),
        panel: "chat" as const,
      })),
    },
    SEND: {
      target: ".conversing",
      actions: assign(({ context, event }) => {
        const question = event.question.trim().slice(0, 800);
        if (!question) return {};
        const reply = authoredReply(
          context.catalog,
          question,
          context.selectedIds,
        );
        return {
          messages: [...context.messages, { ...reply, question }].slice(-4),
          investigated: context.investigated || !!reply.sourceIds.length,
          journalIds: validIds(context.catalog, [
            ...context.journalIds,
            ...reply.sourceIds,
          ]),
          panel: "chat" as const,
        };
      }),
    },
    PANEL: [
      {
        guard: ({ event }) => event.panel === "journal",
        target: ".journaling",
        actions: assign({ panel: ({ event }) => event.panel }),
      },
      {
        target: ".exploring",
        actions: assign({ panel: ({ event }) => event.panel }),
      },
    ],
    TRAIL: { actions: assign({ trail: ({ context }) => !context.trail }) },
    RESTORE: {
      target: ".exploring",
      actions: assign(({ context, event }) => ({
        openIds: validIds(context.catalog, event.openIds).slice(-2),
        panel: event.panel,
      })),
    },
  },
});
