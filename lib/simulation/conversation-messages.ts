/** Protected operational/privacy text. Changes require engineering and owner review. */
export const WORKSPACE_MESSAGES = {
  demo: "Authored demo · no AI requests",
  disclosure: "Fictional guide. Not Anish or his representative.",
  connectionLimit: "Shared subjects or sources, not a claim of collaboration or causality.",
  privacy: "This visual slice uses authored replies and the visible Work archive. No Gemini, connector, or Travel requests occur. Questions and replies stay in this tab’s memory and reset on reload. Do not enter personal information or secrets. Live conversation is pending visual approval.",
  noScript: "Open any object to visit its project, or expand the archive directory. Conversation and connections need JavaScript; project descriptions and sources do not.",
} as const;

export const CONVERSATION_MESSAGES = {
  disclosure:
    "4N1SH is a fictional guide, not Anish or his representative. Answers point to published sources. Do not enter personal information or secrets.",
  processing:
    "Archive search works without a model. Live Gemini is an owner-only preview. An explicit question may send that question and approved source excerpts to Google. No Travel data is included.",
  retention:
    "Transcript text stays in this browser tab’s memory and resets on reload. The server stores source and scene IDs, counters, and replay metadata until session expiry and scheduled cleanup—not questions or generated prose. Sessions expire after one hour. Twenty model calls per session; one hundred per day. Google’s terms govern provider processing.",
  noScript:
    "Choose a suggested discovery or follow the source links. The same evidence is available without JavaScript; free-text conversation needs JavaScript.",
  unavailable:
    "Conversation could not load. Try the same question again, or follow a suggested discovery.",
  status: {
    answered: "Sources found.",
    no_evidence: "No matching evidence. Try a project name or browse Work.",
    screened:
      "Keep questions about the published work. Do not include personal information or secrets.",
    budget: "The model budget is used. Archive search still works.",
    unavailable: "The model is unavailable. These are archive results.",
  },
} as const;
