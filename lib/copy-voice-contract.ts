import type {
  CopyFieldDefinition,
  CopyVoiceProfile,
} from "@/types/copy";

export type CopyVoicePolicy = Pick<
  CopyFieldDefinition,
  | "voiceProfile"
  | "minWords"
  | "maxWords"
  | "maxSentences"
  | "professional"
>;

export const COPY_VOICE_PRINCIPLES = [
  "Lead with the result or useful idea.",
  "Explain the mechanism that produced it.",
  "Attach inspectable proof and its limit.",
  "State why it matters without inflating causality.",
] as const;

export const PLAY_OBJECT_LANGUAGE = {
  watch: { category: "Watch", objectName: "TV" },
  read: { category: "Read", objectName: "Bookshelf" },
  listen: { category: "Listen", objectName: "Music player" },
  collect: { category: "Collect", objectName: "Record crate" },
  play: { category: "Games", objectName: "Computer" },
  move: { category: "Move", objectName: "Treadmill" },
} as const;

const PROFILE_BUDGETS = {
  "metadata-title": { maxWords: 12, maxSentences: 1 },
  "metadata-description": { maxWords: 28, maxSentences: 2 },
  label: { maxWords: 8, maxSentences: 1 },
  heading: { maxWords: 14, maxSentences: 2 },
  cta: { maxWords: 6, maxSentences: 1 },
  period: { maxWords: 5, maxSentences: 1 },
  narrative: { maxWords: 45, maxSentences: 3 },
  "work-title": { maxWords: 18, maxSentences: 1 },
  "work-short-title": { maxWords: 10, maxSentences: 1 },
  "work-summary": { minWords: 6, maxWords: 45, maxSentences: 3 },
  role: { maxWords: 18, maxSentences: 2 },
  "play-object-title": { maxWords: 3, maxSentences: 1 },
  "play-object-description": { minWords: 4, maxWords: 24, maxSentences: 2 },
} as const satisfies Record<
  CopyVoiceProfile,
  { minWords?: number; maxWords: number; maxSentences: number }
>;

function profileForField(surface: string, key: string): CopyVoiceProfile {
  if (surface === "work-group") {
    if (key === "display-title" || key === "home-title") return "work-title";
    if (key === "short-title") return "work-short-title";
    if (key === "summary") return "work-summary";
    return "role";
  }
  if (surface === "play" && /^(?:watch|read|listen|collect|play|move)-title$/u.test(key)) {
    return "play-object-title";
  }
  if (surface === "play" && /^(?:watch|read|listen|collect|play|move)-description$/u.test(key)) {
    return "play-object-description";
  }
  if (key === "seo-title" || key === "default-title" || key === "title-template") {
    return "metadata-title";
  }
  if (key === "seo-description" || key.endsWith("-description")) {
    return "metadata-description";
  }
  if (key.endsWith("-period")) return "period";
  if (
    key.endsWith("-cta") ||
    key === "clear-search" ||
    key.startsWith("header-") ||
    key.startsWith("footer-") ||
    key === "skip-link"
  ) {
    return "cta";
  }
  if (
    key.endsWith("-eyebrow") ||
    key.endsWith("-label") ||
    key.endsWith("-placeholder") ||
    key === "not-found-code"
  ) {
    return "label";
  }
  if (
    key.endsWith("-title") ||
    key.endsWith("-heading") ||
    key === "profile-headline"
  ) {
    return "heading";
  }
  return "narrative";
}

export function copyVoicePolicyForField(
  surface: string,
  key: string,
): CopyVoicePolicy {
  const voiceProfile = profileForField(surface, key);
  return {
    voiceProfile,
    ...PROFILE_BUDGETS[voiceProfile],
    professional: true,
  };
}
