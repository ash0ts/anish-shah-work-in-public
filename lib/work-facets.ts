import type { WorkArchiveRecord } from "@/lib/work-index";

type FacetDefinition<Id extends string> = {
  id: Id;
  label: string;
};

export const themeFacetDefinitions = [
  { id: "foundation-models", label: "Foundation models" },
  {
    id: "ml-systems-infrastructure",
    label: "ML systems & infrastructure",
  },
  { id: "open-source-ecosystems", label: "Open-source ecosystems" },
  {
    id: "evaluation-observability",
    label: "Evaluation & observability",
  },
  { id: "agent-systems", label: "Agent systems" },
  { id: "education-community", label: "Education & community" },
  {
    id: "retrieval-knowledge-systems",
    label: "Retrieval & knowledge systems",
  },
  { id: "applied-ml", label: "Applied ML" },
] as const satisfies readonly FacetDefinition<string>[];

export const mediaFacetDefinitions = [
  { id: "live-session", label: "Live session" },
  { id: "publication", label: "Publication" },
  { id: "recorded-media", label: "Recorded media" },
  { id: "software", label: "Software" },
  { id: "course", label: "Course" },
] as const satisfies readonly FacetDefinition<string>[];

export const ecosystemFacetDefinitions = [
  { id: "weights-biases", label: "Weights & Biases" },
  { id: "open-source", label: "Open-source ecosystems" },
  {
    id: "events-communities",
    label: "Events & practitioner communities",
  },
  { id: "learning-media", label: "Learning & media" },
  { id: "google", label: "Google" },
  { id: "microsoft", label: "Microsoft" },
  { id: "mlops-community", label: "MLOps community" },
  { id: "nvidia", label: "NVIDIA" },
  {
    id: "data-compute-platforms",
    label: "Data & compute platforms",
  },
] as const satisfies readonly FacetDefinition<string>[];

export const contributionFacetDefinitions = [
  { id: "speaker-presenter", label: "Speaker / presenter" },
  { id: "author-coauthor", label: "Author / coauthor" },
  { id: "builder-contributor", label: "Builder / contributor" },
  { id: "instructor-educator", label: "Instructor / educator" },
  { id: "producer-reviewer", label: "Producer / reviewer" },
  { id: "host-organizer", label: "Host / organizer" },
] as const satisfies readonly FacetDefinition<string>[];

export type ThemeFacetId = (typeof themeFacetDefinitions)[number]["id"];
export type MediaFacetId = (typeof mediaFacetDefinitions)[number]["id"];
export type EcosystemFacetId =
  (typeof ecosystemFacetDefinitions)[number]["id"];
export type ContributionFacetId =
  (typeof contributionFacetDefinitions)[number]["id"];

export type WorkFacets = {
  theme: ThemeFacetId[];
  media: MediaFacetId[];
  ecosystem: EcosystemFacetId[];
  contribution: ContributionFacetId;
};

export type WorkFacetDimension = keyof WorkFacets;

export type WorkFacetSelectOption = {
  value: string;
  label: string;
  count: number;
};

const themeByCanonicalTopic: Record<string, ThemeFacetId> = {
  llms: "foundation-models",
  "fine-tuning": "foundation-models",
  multimodal: "foundation-models",
  mlops: "ml-systems-infrastructure",
  cloud: "ml-systems-infrastructure",
  "open-source": "open-source-ecosystems",
  evaluation: "evaluation-observability",
  weave: "evaluation-observability",
  agents: "agent-systems",
  mcp: "agent-systems",
  education: "education-community",
  community: "education-community",
  rag: "retrieval-knowledge-systems",
  healthcare: "applied-ml",
};

const mediaByCanonicalFormat: Record<string, MediaFacetId | null> = {
  event: "live-session",
  article: "publication",
  technical_report: "publication",
  recording: "recorded-media",
  producer_credit: "recorded-media",
  open_source_repo: "software",
  open_source_pr: "software",
  course: "course",
  // These are representations of another public form, not useful media
  // categories of their own. They remain searchable in the canonical data.
  translation: null,
  mirror: null,
  external_reference: null,
};

const ecosystemMatchers: Array<{
  id: EcosystemFacetId;
  pattern: RegExp;
}> = [
  {
    id: "weights-biases",
    pattern: /weights & biases|\bw&b\b/i,
  },
  {
    id: "open-source",
    pattern:
      /github|hugging face|langchain|lightning ai|openai|gpt engineer|open interpreter/i,
  },
  {
    id: "events-communities",
    pattern:
      /anyscale|ray summit|odsc|ai tinkerers|genai innovators|bay area ai|cerebral valley|shack15|ai stac|judgment day|devpost|mdli ops/i,
  },
  {
    id: "learning-media",
    pattern:
      /class central|deeplearning\.ai|fourthbrain|datatalksclub|bilibili|forem|harpreet sahota|note\.com|actualtech media/i,
  },
  { id: "google", pattern: /google/i },
  { id: "microsoft", pattern: /microsoft|azure/i },
  { id: "mlops-community", pattern: /mlops/i },
  { id: "nvidia", pattern: /nvidia|\bgtc\b/i },
  {
    id: "data-compute-platforms",
    pattern: /snowflake|pinecone|coreweave/i,
  },
];

const definitionsByDimension = {
  theme: themeFacetDefinitions,
  media: mediaFacetDefinitions,
  ecosystem: ecosystemFacetDefinitions,
  contribution: contributionFacetDefinitions,
} as const;

function uniqueDefined<Id extends string>(
  values: Array<Id | null | undefined>,
): Id[] {
  return [...new Set(values.filter((value): value is Id => Boolean(value)))];
}

function contributionForRecord(
  record: WorkArchiveRecord,
): ContributionFacetId {
  const role = record.role;

  if (/judge|producer/i.test(role)) return "producer-reviewer";
  if (/instructor|workshop/i.test(role)) return "instructor-educator";
  if (/host|organizer/i.test(role)) return "host-organizer";
  if (
    /implementation contributor|contributor|creator|repository owner|project author/i.test(
      role,
    )
  ) {
    return "builder-contributor";
  }
  if (/author|coauthor|report owner/i.test(role)) return "author-coauthor";
  if (/speaker|presenter|guest|deep dive|listed/i.test(role)) {
    return "speaker-presenter";
  }

  // A body is a reliable last-resort presentation context. The full canonical
  // role remains visible and searchable, so this fallback does not rewrite it.
  if (record.bucket === "products-open-source") return "builder-contributor";
  if (record.bucket === "courses-learning") return "instructor-educator";
  if (record.bucket === "writing-research") return "author-coauthor";
  return "speaker-presenter";
}

export function workFacetsForRecord(
  record: WorkArchiveRecord,
): WorkFacets {
  const organizationNames = record.organizationNames.join(" ");

  return {
    theme: uniqueDefined(
      record.topics.map((topic) => themeByCanonicalTopic[topic]),
    ),
    media: uniqueDefined(
      record.formats.map((format) => mediaByCanonicalFormat[format]),
    ),
    ecosystem: ecosystemMatchers
      .filter(({ pattern }) => pattern.test(organizationNames))
      .map(({ id }) => id),
    contribution: contributionForRecord(record),
  };
}

/**
 * Counts each work once per derived facet and returns select-ready options in
 * the intentional definition order. Facets with no matching work are omitted.
 */
export function countWorkFacetOptions(
  records: WorkArchiveRecord[],
  dimension: WorkFacetDimension,
): WorkFacetSelectOption[] {
  const counts = new Map<string, number>();

  for (const record of records) {
    const facets = workFacetsForRecord(record);
    const values =
      dimension === "contribution"
        ? [facets.contribution]
        : facets[dimension];
    for (const value of new Set(values)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return definitionsByDimension[dimension].flatMap(({ id, label }) => {
    const count = counts.get(id) ?? 0;
    return count ? [{ value: id, label, count }] : [];
  });
}
