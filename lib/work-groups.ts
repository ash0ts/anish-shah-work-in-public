import type {
  AnishContentBundle,
  WorkBucket as WorkBucketId,
  WorkGroup,
} from "@/types/content";
import { SITE_COPY } from "@/lib/copy";

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

export function publicWorkGroupsFrom(
  bundle: AnishContentBundle,
): PublicWorkGroup[] {
  return ((bundle as BundleWithWorkGroups).workGroups ?? []).filter(
    (group) => group.publicationState === "public",
  );
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
