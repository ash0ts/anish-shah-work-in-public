import publicBundleJson from "../content/public/anish-content.public.v1.json" with {
  type: "json",
};
import {
  COPY_VERSION,
  WORK_GROUP_COPY,
} from "../.generated/site-copy.ts";
import { COPY_PAGE_DEFINITIONS } from "./copy-contract.ts";
import type {
  CopyPageId,
  CopyRisk,
  WorkGroupCopy,
} from "../types/copy.ts";
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

export type CopyOwnershipSurface = {
  id: CopyPageId;
  deckPath: `content/copy/pages/${CopyPageId}.md`;
  routeScopes: readonly string[];
  fieldCount: number;
  riskCounts: Record<CopyRisk, number>;
  fields: ReadonlyArray<{
    key: string;
    risk: CopyRisk;
  }>;
};

export type CopyOwnershipReport = {
  schemaVersion: "1.1";
  copyVersion: string;
  precedence: "git_copy_deck_after_canonical_and_d1_structure";
  summary: {
    workGroupCount: number;
    retainedD1WordingCount: number;
    differingD1WordingCount: number;
    missingD1RecordCount: number;
  };
  surfaceSummary: {
    surfaceCount: number;
    fieldCount: number;
    riskCounts: Record<CopyRisk, number>;
  };
  surfaces: CopyOwnershipSurface[];
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

const COPY_PAGE_ROUTE_SCOPES = {
  site: ["all public routes", "/404"],
  home: ["/"],
  about: ["/about"],
  work: ["/work", "/work/[slug]"],
  play: ["/play", "/play/[object]"],
  sources: ["/sources"],
  simulation: ["/simulation (dormant)"],
} as const satisfies Record<CopyPageId, readonly string[]>;

function pageCopySurfaces(): CopyOwnershipSurface[] {
  return (Object.keys(COPY_PAGE_DEFINITIONS) as CopyPageId[]).map((id) => {
    const fields = COPY_PAGE_DEFINITIONS[id].map((definition) => ({
      key: definition.key,
      risk: definition.risk,
    }));
    return {
      id,
      deckPath: `content/copy/pages/${id}.md`,
      routeScopes: COPY_PAGE_ROUTE_SCOPES[id],
      fieldCount: fields.length,
      riskCounts: {
        editorial: fields.filter((field) => field.risk === "editorial").length,
        fact_check: fields.filter((field) => field.risk === "fact_check").length,
      },
      fields,
    };
  });
}

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
  const surfaces = pageCopySurfaces();
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
    schemaVersion: "1.1",
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
    surfaceSummary: {
      surfaceCount: surfaces.length,
      fieldCount: surfaces.reduce(
        (total, surface) => total + surface.fieldCount,
        0,
      ),
      riskCounts: {
        editorial: surfaces.reduce(
          (total, surface) => total + surface.riskCounts.editorial,
          0,
        ),
        fact_check: surfaces.reduce(
          (total, surface) => total + surface.riskCounts.fact_check,
          0,
        ),
      },
    },
    surfaces,
    records,
  };
}
