import type { ConversationSource } from "./conversation-contract";

export type InternetObject = ConversationSource & {
  label: string;
  kind: "terminal" | "notebook" | "document" | "poster";
  topics: Array<{ id: string; label: string }>;
};
