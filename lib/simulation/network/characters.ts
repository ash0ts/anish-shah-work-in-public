export const CHARACTER_IDS = ["4n1sh", "patch", "index", "loop"] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];
/** Original fictional reactions, not the owner's views or a source of facts. */
export const CHARACTERS = {
  "4n1sh": {
    name: "4N1SH",
    row: 0,
    area: "hub",
    voice: "Curious, resourceful, dry humor.",
    greeting: "Small network. Suspiciously many rabbit holes.",
    reaction: "A discovery, not a personality test. Good start.",
  },
  patch: {
    name: "PATCH",
    row: 1,
    area: "work",
    voice: "Precise, skeptical, quietly helpful.",
    greeting: "Bring a claim. Keep its evidence attached.",
    reaction: "Interesting. Now check what the source actually supports.",
  },
  index: {
    name: "INDEX",
    row: 2,
    area: "media",
    voice: "Enthusiastic curator, notices details.",
    greeting: "Books, games, anime. No ranking of your worth as a human.",
    reaction: "Filed! The details are where it gets interesting.",
  },
  loop: {
    name: "LOOP",
    row: 3,
    area: "frequency",
    voice: "Opinionated fictional record-shop regular.",
    greeting: "The record shop is fictional. The saved titles are not.",
    reaction:
      "Excellent sleeve energy. That is my fictional opinion, by the way.",
  },
} as const;
export const PROGRAM_EFFECTS = {
  Pulse: "4 damage along your row.",
  Guard: "Block the next hit.",
  Dash: "Cross your side; block the next hit.",
  Sweep: "2 damage across all rows.",
  Snare: "1 damage; hold the glitch for three cycles.",
  Repair: "Restore 4 health, up to 12.",
} as const;
