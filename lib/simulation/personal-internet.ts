import type { ConversationSource } from "./conversation-contract";
import { searchConversationSources } from "./conversation-contract";

export type InternetObject = ConversationSource & {
  label: string;
  kind: "terminal" | "notebook" | "document" | "poster";
  topics: Array<{ id: string; label: string }>;
};
export type DocumentedConnection = {
  ids: [string, string];
  topics: InternetObject["topics"];
  citations: ConversationSource["citations"];
  supported: boolean;
};

/** A shared topic/source is not an affiliation, dependency, or causal claim. */
export function connectObjects(
  a: InternetObject,
  b: InternetObject,
): DocumentedConnection {
  const topics = a.topics.filter((topic) =>
    b.topics.some(({ id }) => id === topic.id),
  );
  const citations = a.citations.filter((source) =>
    b.citations.some(({ id }) => id === source.id),
  );
  return {
    ids: [a.id, b.id],
    topics,
    citations,
    supported: a.id !== b.id && !!(topics.length || citations.length),
  };
}

export type DemoReply = { text: string; sourceIds: string[] };

/** Reviewed templates, never a simulated model response. No network or persistence. */
export function authoredReply(
  catalog: InternetObject[],
  question: string,
  selected: string[],
): DemoReply {
  const focus = selected
    .flatMap((id) => catalog.find((object) => object.id === id) ?? [])
    .slice(0, 2);
  if (
    /connect|relat|shared|together|compare/i.test(question) &&
    focus.length === 2
  ) {
    const connection = connectObjects(focus[0], focus[1]);
    return {
      text: connection.supported
        ? `These objects share ${connection.topics.map((topic) => topic.label).join(", ") || "a published source"}. That is an archive connection, not evidence that one project caused the other. Open either project to compare the implementation and its limits. The dotted line is a reading path, not an org chart.`
        : "No documented connection appears in their topics or sources. That does not prove the projects are unrelated; this archive simply does not establish a link. Open the projects separately, or try another pair. Nothing needs to be forced together just because it fits on the same screen.",
      sourceIds: focus.map((object) => object.id),
    };
  }
  const matches = searchConversationSources(catalog, question).slice(0, 2);
  const sources =
    focus.length && /\b(this|these|it|more)\b/i.test(question)
      ? focus
      : matches;
  if (!sources.length)
    return {
      text: "This authored demo can find projects and compare their documented topics. It cannot improvise an answer to that question. Try a project name, select an object, or ask how a selected pair connects. The full archive is still available; the small creature has not eaten it.",
      sourceIds: [],
    };
  return {
    text: sources
      .map((source) => `${source.title}. ${source.text}`)
      .join("\n\n"),
    sourceIds: sources.map((source) => source.id),
  };
}
