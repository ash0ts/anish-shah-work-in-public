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
      actions: assign(({ context, event }) => ({
        selectedIds: context.selectedIds.includes(event.id)
          ? context.selectedIds.filter((id) => id !== event.id)
          : validIds(context.catalog, [...context.selectedIds, event.id]).slice(
              -2,
            ),
        connection: null,
      })),
    },
    CONNECT: {
      target: ".connecting",
      actions: assign(({ context }) => {
        const pair = context.selectedIds.flatMap(
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
