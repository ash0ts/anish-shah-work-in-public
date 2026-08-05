import type {
  AnishContentBundle,
  PortfolioItem,
  WorkBucket,
  WorkGroup,
} from "@/types/content";
import { workOrganizationMarkIdsByGroupFrom } from "@/lib/work-organizations";

export type WorkIndexEntry = {
  id: string;
  slug: string;
  title: string;
  year: number | null;
  practice: "teach" | "build" | "convene";
  formCount: number;
  kind: string;
  role: string;
};

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

export type WorkArchiveRecord = WorkIndexEntry & {
  recordType: "work_group" | "entity";
  bucket: WorkBucket | null;
  featuredOrder: number | null;
  yearStart: number | null;
  yearEnd: number | null;
  memberEntityIds: string[];
  contextEntityIds: string[];
  summary: string | null;
  topics: string[];
  organizationIds: string[];
  organizationNames: string[];
  organizationMarkIds: string[];
  formats: string[];
  searchAliases: string[];
  childTitles: string[];
  childItems: Array<{
    id: string;
    slug: string;
    title: string;
    displayTitle: string;
    shortTitle: string;
    aliases: string[];
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
  const publicWorkGroups = (bundle.workGroups ?? []).filter(
    (group) => group.publicationState === "public",
  );
  const organizationMarkIdsByGroup =
    workOrganizationMarkIdsByGroupFrom(bundle);

  if (publicWorkGroups.length) {
    return publicWorkGroups.flatMap((group) =>
      workGroupRecord(
        group,
        bundle,
        itemById,
        organizationById,
        organizationMarkIdsByGroup,
      ),
    );
  }

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
      recordType: "entity",
      bucket: null,
      featuredOrder: item.featured ? 1 : null,
      yearStart: item.year,
      yearEnd: item.year,
      memberEntityIds: [item.canonicalEntityId],
      contextEntityIds: [],
      formCount: 1,
      kind: item.type,
      role: item.role,
      summary: item.summary,
      topics: item.topics,
      organizationIds: item.organizationIds,
      organizationNames: item.organizationIds
        .map((id) => organizationById.get(id))
        .filter((name): name is string => Boolean(name)),
      organizationMarkIds: [],
      formats: [item.type],
      searchAliases: [
        item.displayTitle,
        item.shortTitle,
        ...item.slugAliases,
      ],
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
        recordType: "entity",
        bucket: null,
        featuredOrder: primary.featured ? 1 : null,
        yearStart: entity.year ?? primary.year,
        yearEnd: entity.year ?? primary.year,
        memberEntityIds: [entity.id],
        contextEntityIds: [],
        formCount: Math.max(members.length, 1),
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
        organizationMarkIds: [],
        formats: [...new Set(members.map((item) => item.type))],
        searchAliases: [
          ...(entity.slugAliases ?? []),
          entity.title,
          entity.shortTitle ?? "",
          primary.title,
          primary.displayTitle,
          primary.shortTitle,
          ...primary.slugAliases,
        ].filter(Boolean),
        childTitles: members
          .filter((item) => item.id !== primary.id)
          .map((item) => item.title),
        childItems: members
          .filter((item) => item.id !== primary.id)
          .map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
            displayTitle: item.displayTitle,
            shortTitle: item.shortTitle,
            aliases: item.slugAliases,
            type: item.type,
            role: item.role,
            year: item.year,
          })),
      },
    ];
  });
}

function workGroupRecord(
  group: WorkGroup,
  bundle: AnishContentBundle,
  itemById: Map<string, PortfolioItem>,
  organizationById: Map<string, string>,
  organizationMarkIdsByGroup: Map<string, string[]>,
): WorkArchiveRecord[] {
  const members = group.itemIds
    .map((id) => itemById.get(id))
    .filter((item): item is PortfolioItem => Boolean(item));
  if (!members.length) return [];
  const entityById = new Map(
    bundle.entities.map((entity) => [entity.id, entity]),
  );
  const searchableEntities = [
    ...new Set([
      ...group.memberEntityIds,
      ...group.programEntityIds,
      ...group.contextEntityIds,
    ]),
  ]
    .map((id) => entityById.get(id))
    .filter(Boolean);
  const searchableItems = [
    ...new Map(
      searchableEntities
        .flatMap((entity) =>
          entity
            ? entity.itemIds
                .map((id) => itemById.get(id))
                .filter((item): item is PortfolioItem => Boolean(item))
            : [],
        )
        .concat(members)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const practice: WorkIndexEntry["practice"] =
    group.bucket === "courses-learning"
      ? "teach"
      : group.bucket === "talks-programs"
        ? "convene"
        : "build";

  return [
    {
      id: group.id,
      slug: group.slug,
      title: group.title,
      year: group.yearEnd ?? group.yearStart,
      practice,
      recordType: "work_group",
      bucket: group.bucket,
      featuredOrder: group.featuredOrder,
      yearStart: group.yearStart,
      yearEnd: group.yearEnd,
      memberEntityIds: group.memberEntityIds,
      contextEntityIds: group.contextEntityIds,
      formCount: members.length,
      kind: "work_group",
      role: group.roleSummary,
      summary: group.summary,
      topics: group.topics,
      organizationIds: group.organizationIds,
      organizationNames: group.organizationIds
        .map((id) => organizationById.get(id))
        .filter((name): name is string => Boolean(name)),
      organizationMarkIds: organizationMarkIdsByGroup.get(group.id) ?? [],
      formats: group.formats,
      searchAliases: [
        ...group.slugAliases,
        group.shortTitle,
        ...searchableEntities.flatMap((entity) =>
          entity
            ? [
                entity.title,
                entity.displayTitle,
                entity.shortTitle,
                entity.slug,
                ...entity.slugAliases,
              ]
            : [],
        ),
      ].filter(Boolean),
      childTitles: searchableItems.map((item) => item.displayTitle),
      childItems: searchableItems.map((item) => ({
        id: item.id,
        slug: item.slug,
        title: item.title,
        displayTitle: item.displayTitle,
        shortTitle: item.shortTitle,
        aliases: item.slugAliases,
        type: item.type,
        role: item.role,
        year: item.year,
      })),
    },
  ];
}
