export const CONVERSATION_VERSION = "network-v3" as const;
export type DialogueSection = { text: string; sourceIds: string[] };
export type RecentTurn = { question: string; answer: string; sourceIds: string[] };
export const CONVERSATION_SCENES = ["desk", "archive", "doorway"] as const;
export type ConversationScene = (typeof CONVERSATION_SCENES)[number];
export type ConversationSource = {
  id: string;
  title: string;
  text: string;
  limit: string | null;
  href: string;
  period: string | null;
  citations: Array<{ id: string; title: string; href: string }>;
};
export type ConversationReply = {
  version: typeof CONVERSATION_VERSION;
  revision: number;
  source: "gemini" | "archive" | "replayed";
  scene: ConversationScene;
  inspectedIds: string[];
  visibleIds: string[];
  cards: ConversationSource[];
  dialogue?: { sections: DialogueSection[]; reaction: string; highlightIds: string[] };
  status: "answered" | "no_evidence" | "screened" | "budget" | "unavailable";
};
export const CONVERSATION_LIMITS = {
  messageCharacters: 800,
  sessionCalls: 20,
  dailyCalls: 100,
  sessionMilliseconds: 3_600_000,
  deadlineMilliseconds: 10_000,
  sourceCount: 8,
  responseCards: 3,
} as const;

/** Stable, bounded ranking. No network, fuzzy inference, or hidden fields. */
export function searchConversationSources(
  sources: readonly ConversationSource[],
  query: string,
): ConversationSource[] {
  const words = (value: string) =>
    (
      value
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]{2,40}/gu) ?? []
    ).map((word) =>
      word.length > 4 && word.endsWith("s") && !/(ss|us|is)$/.test(word)
        ? word.slice(0, -1)
        : word,
    );
  const tokens = [...new Set(words(query))]
    .filter(
      (token) =>
        !new Set([
          "what",
          "which",
          "about",
          "does",
          "with",
          "have",
          "from",
          "that",
          "this",
          "the",
          "and",
          "how",
          "you",
          "your",
          "anish",
          "show",
          "tell",
          "has",
        ]).has(token),
    )
    .slice(0, 30);
  if (!tokens.length) return [];
  return sources
    .map((source, order) => {
      const title = new Set(words(source.title));
      const text = new Set(words(source.text));
      const score = tokens.reduce(
        (n, token) =>
          n + (title.has(token) ? 5 : 0) + (text.has(token) ? 1 : 0),
        0,
      );
      return { source, score, order };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, CONVERSATION_LIMITS.sourceCount)
    .map(({ source }) => source);
}

export function conversationScene(
  inspectedIds: readonly string[],
): ConversationScene {
  return inspectedIds.length >= 3
    ? "doorway"
    : inspectedIds.length
      ? "archive"
      : "desk";
}
