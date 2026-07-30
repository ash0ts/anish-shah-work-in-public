import type { WorkIndexEntry } from "@/components/LivingWorkIndex";
import type { AnishContentBundle, PortfolioItem } from "@/types/content";

type CanonicalEntityView = {
  id: string;
  kind: "work" | "occurrence" | "artifact" | "program";
  title: string;
  displayTitle?: string;
  shortTitle?: string;
  slug?: string;
  slugAliases?: string[];
  summary?: string | null;
  practice?: "teach" | "build" | "convene";
  countability?: "unique_work" | "representation" | "context";
  sourceBasis?: "footprint" | "supplemental" | "mixed" | "synthetic";
  year?: number | null;
  role?: string;
  organizationIds?: string[];
  topics?: string[];
  childCounts?: { items: number; occurrences: number; artifacts: number };
  primaryItemId: string | null;
  itemIds: string[];
  publicationState: string;
};

type BundleWithEntities = AnishContentBundle & {
  entities?: CanonicalEntityView[];
};

function legacyPractice(item: PortfolioItem): WorkIndexEntry["practice"] {
  if (item.type === "course") return "teach";
  if (
    item.type === "event" ||
    item.type === "recording" ||
    item.type === "producer_credit"
  ) {
    return "convene";
  }
  return "build";
}

export function workIndexEntriesFrom(
  bundle: AnishContentBundle,
): WorkIndexEntry[] {
  const typedBundle = bundle as BundleWithEntities;
  const publishedItems = bundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const itemById = new Map(publishedItems.map((item) => [item.id, item]));
  const canonicalWorks = (typedBundle.entities ?? []).filter(
    (entity) =>
      entity.countability === "unique_work" &&
      entity.sourceBasis !== "supplemental" &&
      entity.publicationState === "public",
  );

  const entries = canonicalWorks.length
    ? canonicalWorks.flatMap((entity): WorkIndexEntry[] => {
        const primary =
          (entity.primaryItemId ? itemById.get(entity.primaryItemId) : undefined) ??
          entity.itemIds.map((id) => itemById.get(id)).find(Boolean);
        if (!primary) return [];
        return [
          {
            id: entity.id,
            slug: entity.slug ?? primary.slug,
            title:
              entity.displayTitle ??
              entity.shortTitle ??
              entity.title ??
              primary.title,
            year: entity.year ?? primary.year,
            practice: entity.practice ?? legacyPractice(primary),
            formCount: Math.max(entity.itemIds.length, 1),
            kind: primary.type,
            role: entity.role ?? primary.role,
          },
        ];
      })
    : publishedItems.map(
        (item): WorkIndexEntry => ({
          id: item.id,
          slug: item.slug,
          title: item.title,
          year: item.year,
          practice: legacyPractice(item),
          formCount: 1,
          kind: item.type,
          role: item.role,
        }),
      );

  return entries.sort(
    (left, right) =>
      (right.year ?? -1) - (left.year ?? -1) ||
      left.title.localeCompare(right.title),
  );
}

export type WorkArchiveRecord = WorkIndexEntry & {
  summary: string | null;
  topics: string[];
  organizationIds: string[];
  organizationNames: string[];
  formats: string[];
  childTitles: string[];
  childItems: Array<{
    id: string;
    slug: string;
    title: string;
    type: string;
    role: string;
    year: number | null;
  }>;
};

export function workArchiveRecordsFrom(
  bundle: AnishContentBundle,
): WorkArchiveRecord[] {
  const typedBundle = bundle as BundleWithEntities;
  const publishedItems = bundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const itemById = new Map(publishedItems.map((item) => [item.id, item]));
  const organizationById = new Map(
    bundle.organizations.map((organization) => [
      organization.id,
      organization.name,
    ]),
  );
  const canonical = (typedBundle.entities ?? []).filter(
    (entity) =>
      entity.countability === "unique_work" &&
      entity.sourceBasis !== "supplemental" &&
      entity.publicationState === "public",
  );

  if (!canonical.length) {
    return publishedItems.map((item) => ({
      id: item.id,
      slug: item.slug,
      title: item.title,
      year: item.year,
      practice: legacyPractice(item),
      formCount: 1,
      kind: item.type,
      role: item.role,
      summary: item.summary,
      topics: item.topics,
      organizationIds: item.organizationIds,
      organizationNames: item.organizationIds
        .map((id) => organizationById.get(id))
        .filter((name): name is string => Boolean(name)),
      formats: [item.type],
      childTitles: [],
      childItems: [],
    }));
  }

  return canonical.flatMap((entity): WorkArchiveRecord[] => {
    const members = entity.itemIds
      .map((id) => itemById.get(id))
      .filter((item): item is PortfolioItem => Boolean(item));
    const primary =
      (entity.primaryItemId ? itemById.get(entity.primaryItemId) : undefined) ??
      members[0];
    if (!primary) return [];
    const organizationIds = entity.organizationIds?.length
      ? entity.organizationIds
      : [...new Set(members.flatMap((item) => item.organizationIds))];
    return [
      {
        id: entity.id,
        slug: entity.slug ?? primary.slug,
        title:
          entity.displayTitle ??
          entity.shortTitle ??
          entity.title ??
          primary.title,
        year: entity.year ?? primary.year,
        practice: entity.practice ?? legacyPractice(primary),
        formCount:
          entity.childCounts?.items ?? Math.max(entity.itemIds.length, 1),
        kind: primary.type,
        role: entity.role ?? primary.role,
        summary: entity.summary ?? primary.summary,
        topics: entity.topics?.length
          ? entity.topics
          : [...new Set(members.flatMap((item) => item.topics))],
        organizationIds,
        organizationNames: organizationIds
          .map((id) => organizationById.get(id))
          .filter((name): name is string => Boolean(name)),
        formats: [...new Set(members.map((item) => item.type))],
        childTitles: members
          .filter((item) => item.id !== primary.id)
          .map((item) => item.title),
        childItems: members
          .filter((item) => item.id !== primary.id)
          .map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
            type: item.type,
            role: item.role,
            year: item.year,
          })),
      },
    ];
  });
}

const preferredHomeMatches: Record<WorkIndexEntry["practice"], RegExp[]> = {
  teach: [/llm apps.*evaluation/i, /developer.*prompting/i, /ai engineering.*agents/i],
  build: [/mcp server/i, /evalforge/i, /fabric/i],
  convene: [/fully connected/i, /nvidia.*gtc/i, /genai application/i],
};

export function representativeWorksFrom(
  entries: WorkIndexEntry[],
): WorkIndexEntry[] {
  return (["teach", "build", "convene"] as const).flatMap((practice) => {
    const candidates = entries.filter((entry) => entry.practice === practice);
    const preferred = preferredHomeMatches[practice]
      .map((pattern) => candidates.find((entry) => pattern.test(entry.title)))
      .find(Boolean);
    return preferred ? [preferred] : candidates.slice(0, 1);
  });
}
