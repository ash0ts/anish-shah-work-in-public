export type CopyRisk = "editorial" | "fact_check";

export type CopyVoiceProfile =
  | "metadata-title"
  | "metadata-description"
  | "label"
  | "heading"
  | "cta"
  | "period"
  | "narrative"
  | "work-title"
  | "work-short-title"
  | "work-summary"
  | "work-role-summary"
  | "role"
  | "play-object-title"
  | "play-object-description";

export type CopyFieldDefinition = {
  key: string;
  surface: string;
  risk: CopyRisk;
  required: boolean;
  maxLength: number;
  allowParagraphs: boolean;
  voiceProfile?: CopyVoiceProfile;
  minWords?: number;
  maxWords?: number;
  maxSentences?: number;
  professional?: boolean;
};

export type CopyPageId = "site" | "home" | "work" | "play" | "sources";

export type WorkGroupCopy = {
  displayTitle: string;
  shortTitle: string;
  summary: string;
  roleSummary: string;
  homeTitle?: string;
  homeRole?: string;
};
