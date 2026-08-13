import publicBundleJson from "../content/public/anish-content.public.v1.json" with {
  type: "json",
};
import {
  COPY_VERSION,
  WORK_GROUP_COPY,
} from "../.generated/site-copy.ts";
import type { WorkGroupCopy } from "../types/copy.ts";
import { validatePublicProjection } from "./server/editorial-policy.ts";

export const GIT_OWNED_WORK_GROUP_FIELDS = [
  "display-title",
  "short-title",
  "summary",
  "role-summary",
] as const;

export type CopyOwnershipSourceRecord = {
  id: string;
  recordType: string;
  approvedPublicWording: string;
};

export type CopyOwnershipRecord = {
  id: string;
  slug: string;
  deckPath: string;
  gitCopy: {
    displayTitle: string;
    shortTitle: string;
    summary: string;
    roleSummary: string;
  };
  gitOwnedFields: readonly string[];
  d1RecordPresent: boolean;
  ignoredD1Wording: string | null;
  ignoredD1WordingState: "none" | "matches_copy" | "differs_from_copy";
};

export type CopyOwnershipReport = {
  schemaVersion: "1.0";
  copyVersion: string;
  precedence: "git_copy_deck_after_canonical_and_d1_structure";
  summary: {
    workGroupCount: number;
    retainedD1WordingCount: number;
    differingD1WordingCount: number;
    missingD1RecordCount: number;
  };
  records: CopyOwnershipRecord[];
};

export class CopyOwnershipError extends Error {
  readonly code = "invalid_copy_ownership_state";

  constructor() {
    super("The copy ownership report contains an invalid retained value.");
    this.name = "CopyOwnershipError";
  }
}

type PublicWorkGroup = {
  id: string;
  slug: string;
  publicationState: string;
};

const publicWorkGroups = (
  publicBundleJson as { workGroups: PublicWorkGroup[] }
).workGroups.filter((group) => group.publicationState === "public");

function retainedWording(value: string | undefined): string | null {
  const wording = value?.trim() ?? "";
  if (!wording) return null;
  if (wording.length > 600) throw new CopyOwnershipError();
  const validation = validatePublicProjection(
    wording,
    "copyOwnership.ignoredD1Wording",
  );
  if (!validation.ok) throw new CopyOwnershipError();
  return wording;
}

function currentDeckValue(
  value: string | undefined,
  field: string,
  options: { maxLength?: number } = {},
): string {
  const copy = value?.trim() ?? "";
  if (!copy) {
    throw new CopyOwnershipError();
  }
  if (copy.length > (options.maxLength ?? 600)) {
    throw new CopyOwnershipError();
  }
  const validation = validatePublicProjection(copy, `copyOwnership.${field}`);
  if (!validation.ok) throw new CopyOwnershipError();
  return copy;
}

export function buildCopyOwnershipReport(
  sourceRecords: readonly CopyOwnershipSourceRecord[],
): CopyOwnershipReport {
  const recordsById = new Map<string, CopyOwnershipSourceRecord>();
  for (const record of sourceRecords) {
    if (record.recordType !== "work_group") continue;
    if (recordsById.has(record.id)) throw new CopyOwnershipError();
    recordsById.set(record.id, record);
  }

  const records = publicWorkGroups.map((group): CopyOwnershipRecord => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(group.slug)) {
      throw new CopyOwnershipError();
    }
    const copy = WORK_GROUP_COPY[
      group.id as keyof typeof WORK_GROUP_COPY
    ] as WorkGroupCopy | undefined;
    if (!copy) throw new CopyOwnershipError();
    const sourceRecord = recordsById.get(group.id);
    const ignoredD1Wording = retainedWording(
      sourceRecord?.approvedPublicWording,
    );
    const displayTitle = currentDeckValue(copy.displayTitle, "displayTitle", {
      maxLength: 180,
    });
    const shortTitle = currentDeckValue(copy.shortTitle, "shortTitle", {
      maxLength: 140,
    });
    const summary = currentDeckValue(copy.summary, "summary", {
      maxLength: 500,
    });
    const roleSummary = currentDeckValue(copy.roleSummary, "roleSummary", {
      maxLength: 180,
    });
    if (!displayTitle || !shortTitle || !summary || !roleSummary) {
      throw new CopyOwnershipError();
    }
    return {
      id: group.id,
      slug: group.slug,
      deckPath: `content/copy/work-groups/${group.slug}.md`,
      gitCopy: {
        displayTitle,
        shortTitle,
        summary,
        roleSummary,
      },
      gitOwnedFields: GIT_OWNED_WORK_GROUP_FIELDS,
      d1RecordPresent: Boolean(sourceRecord),
      ignoredD1Wording,
      ignoredD1WordingState:
        ignoredD1Wording === null
          ? "none"
          : ignoredD1Wording === copy.summary
            ? "matches_copy"
            : "differs_from_copy",
    };
  });

  return {
    schemaVersion: "1.0",
    copyVersion: COPY_VERSION,
    precedence: "git_copy_deck_after_canonical_and_d1_structure",
    summary: {
      workGroupCount: records.length,
      retainedD1WordingCount: records.filter(
        (record) => record.ignoredD1Wording !== null,
      ).length,
      differingD1WordingCount: records.filter(
        (record) => record.ignoredD1WordingState === "differs_from_copy",
      ).length,
      missingD1RecordCount: records.filter(
        (record) => !record.d1RecordPresent,
      ).length,
    },
    records,
  };
}
