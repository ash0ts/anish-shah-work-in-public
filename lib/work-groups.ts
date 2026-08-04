import type {
  AnishContentBundle,
  WorkBucket as WorkBucketId,
  WorkGroup,
} from "@/types/content";
import { SITE_COPY, workGroupCopyFor } from "@/lib/copy";

type BundleWithWorkGroups = AnishContentBundle & {
  workGroups?: WorkGroup[];
};

export type PublicWorkGroup = WorkGroup;

export type WorkBucket = {
  id: WorkBucketId;
  title: string;
  shortTitle: string;
  statement: string;
};

export const workBuckets: WorkBucket[] = [
  {
    id: "products-open-source",
    title: SITE_COPY.work["bucket-1-title"],
    shortTitle: SITE_COPY.work["bucket-1-short-title"],
    statement: SITE_COPY.work["bucket-1-statement"],
  },
  {
    id: "courses-learning",
    title: SITE_COPY.work["bucket-2-title"],
    shortTitle: SITE_COPY.work["bucket-2-short-title"],
    statement: SITE_COPY.work["bucket-2-statement"],
  },
  {
    id: "writing-research",
    title: SITE_COPY.work["bucket-3-title"],
    shortTitle: SITE_COPY.work["bucket-3-short-title"],
    statement: SITE_COPY.work["bucket-3-statement"],
  },
  {
    id: "talks-programs",
    title: SITE_COPY.work["bucket-4-title"],
    shortTitle: SITE_COPY.work["bucket-4-short-title"],
    statement: SITE_COPY.work["bucket-4-statement"],
  },
];

const fallbackEntityIds: Record<WorkBucketId, string[]> = {
  "products-open-source": [
    "entity:wk-0001",
    "entity:wk-0003",
    "entity:wk-0002",
  ],
  "courses-learning": [
    "entity:wk-fp-0065",
    "entity:wk-fp-0066",
    "entity:wk-fp-0067",
  ],
  "writing-research": [
    "entity:wk-fp-0055",
    "entity:wk-fp-0053",
    "entity:wk-fp-0061",
  ],
  "talks-programs": [
    "entity:oc-fp-0045",
    "entity:oc-fp-0010",
    "entity:oc-fp-0046",
  ],
};

export function publicWorkGroupsFrom(
  bundle: AnishContentBundle,
): PublicWorkGroup[] {
  return ((bundle as BundleWithWorkGroups).workGroups ?? []).filter(
    (group) => group.publicationState === "public",
  );
}

export function featuredWorkBucketsFrom(bundle: AnishContentBundle) {
  const publicGroups = publicWorkGroupsFrom(bundle);
  const groups = publicGroups.length
    ? publicGroups
    : fallbackGroupsFromEntities(bundle);
  return workBuckets.map((bucket) => ({
    ...bucket,
    groups: groups
      .filter((group) => group.bucket === bucket.id)
      .filter((group) => group.featuredOrder !== null)
      .sort(
        (left, right) =>
          (left.featuredOrder ?? Number.MAX_SAFE_INTEGER) -
            (right.featuredOrder ?? Number.MAX_SAFE_INTEGER) ||
          left.title.localeCompare(right.title),
      )
      .slice(0, 3)
      .map((group) => {
        const presentation = workGroupCopyFor(group.id);
        return {
          ...group,
          homeTitle:
            presentation?.homeTitle ?? (group.shortTitle || group.title),
          homeRole: presentation?.homeRole ?? group.roleSummary,
        };
      }),
  }));
}

export function findWorkGroupBySlugFrom(
  bundle: AnishContentBundle,
  slug: string,
) {
  return publicWorkGroupsFrom(bundle).find(
    (group) => group.slug === slug || group.slugAliases.includes(slug),
  );
}

export function workGroupForEntityFrom(
  bundle: AnishContentBundle,
  entityId: string,
) {
  const groups = publicWorkGroupsFrom(bundle);
  const direct = groups.find((group) =>
    group.memberEntityIds.includes(entityId),
  );
  if (direct) return direct;
  const contextual = groups.filter(
    (group) =>
      group.programEntityIds.includes(entityId) ||
      group.contextEntityIds.includes(entityId),
  );
  return contextual.length === 1 ? contextual[0] : undefined;
}

export function workGroupPeriodLabel(group: PublicWorkGroup) {
  if (group.yearStart && group.yearEnd && group.yearStart !== group.yearEnd) {
    return `${group.yearStart}—${String(group.yearEnd).slice(-2)}`;
  }
  return String(group.yearEnd ?? group.yearStart ?? "Undated");
}

function fallbackGroupsFromEntities(
  bundle: AnishContentBundle,
): PublicWorkGroup[] {
  const itemById = new Map(bundle.items.map((item) => [item.id, item]));
  return workBuckets.flatMap((bucket) =>
    fallbackEntityIds[bucket.id].flatMap((entityId, index) => {
      const entity = bundle.entities.find(
        (candidate) =>
          candidate.id === entityId && candidate.publicationState === "public",
      );
      if (!entity) return [];
      const items = entity.itemIds
        .map((itemId) => itemById.get(itemId))
        .filter(Boolean);
      const formats = [
        ...new Set(
          items.flatMap((item) => (item ? [item.type] : [])),
        ),
      ];
      return [
        {
          id: `fallback:${entity.id}`,
          slug: entity.slug,
          slugAliases: entity.slugAliases,
          title: entity.displayTitle,
          shortTitle: entity.shortTitle,
          summary: entity.summary,
          bucket: bucket.id,
          featuredOrder: index + 1,
          primaryEntityId: entity.id,
          memberEntityIds: [entity.id],
          programEntityIds: [],
          contextEntityIds: [],
          itemIds: entity.itemIds,
          yearStart: entity.year,
          yearEnd: entity.year,
          roleSummary: entity.role,
          period: entity.representativeDate,
          organizationIds: entity.organizationIds,
          topics: entity.topics,
          formats,
          publicationState: "public",
          verificationState: entity.verificationState,
        },
      ] satisfies PublicWorkGroup[];
    }),
  );
}
