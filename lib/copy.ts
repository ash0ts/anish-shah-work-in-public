import {
  COPY_VERSION,
  SITE_COPY,
  WORK_GROUP_COPY,
} from "@/.generated/site-copy";
import type { AnishContentBundle } from "@/types/content";
import type { WorkGroupCopy } from "@/types/copy";

export { COPY_VERSION, SITE_COPY, WORK_GROUP_COPY };

export function workGroupCopyFor(id: string): WorkGroupCopy | undefined {
  return WORK_GROUP_COPY[id as keyof typeof WORK_GROUP_COPY] as
    | WorkGroupCopy
    | undefined;
}

/**
 * Git-owned copy is applied to the sanitized canonical bundle before the D1
 * publication selector. It can replace only the profile and WorkGroup text
 * declared in the copy contract. D1 then retains control of visibility,
 * ordering, feature state, and caveats; structural fields, metrics, evidence,
 * relations, and URLs remain untouched.
 */
export function applyCopyDeckToBundle(
  bundle: AnishContentBundle,
): AnishContentBundle {
  return {
    ...bundle,
    profile: {
      ...bundle.profile,
      headline: SITE_COPY.home["profile-headline"],
      summary: SITE_COPY.home["profile-summary"],
      primaryCta: {
        ...bundle.profile.primaryCta,
        label: SITE_COPY.home["primary-cta"],
      },
    },
    workGroups: bundle.workGroups.map((group) => {
      const copy = workGroupCopyFor(group.id);
      return copy
        ? {
            ...group,
            title: copy.displayTitle,
            shortTitle: copy.shortTitle,
            summary: copy.summary,
            roleSummary: copy.roleSummary,
          }
        : group;
    }),
  };
}
