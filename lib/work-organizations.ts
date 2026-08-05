import manifestJson from "@/content/presentation/work-organizations.v1.json" with {
  type: "json",
};
import type { AnishContentBundle, WorkGroup } from "@/types/content";

export const workOrganizationGroupDefinitions = [
  { id: "built-at", label: "Built at" },
  { id: "contributed-to", label: "Contributed to" },
  { id: "presented-with-or-at", label: "Presented with or at" },
] as const;

export type WorkOrganizationGroupId =
  (typeof workOrganizationGroupDefinitions)[number]["id"];

export type WorkOrganizationLogo = {
  assetPath: `/assets/organizations/${string}.svg`;
  sourceUrl: string;
  lastVerified: string;
};

export type WorkOrganizationMark = {
  id: string;
  name: string;
  group: WorkOrganizationGroupId;
  secondaryGroups: WorkOrganizationGroupId[];
  sourceOrganizationIds: string[];
  workGroupIds: string[];
  featuredOrder: number;
  logo: WorkOrganizationLogo | null;
};

export type ResolvedWorkOrganizationMark = WorkOrganizationMark & {
  projectCount: number;
};

export type ResolvedWorkOrganizationSection = {
  id: WorkOrganizationGroupId;
  label: string;
  marks: ResolvedWorkOrganizationMark[];
};

type WorkOrganizationManifest = {
  schemaVersion: "1.0";
  marks: WorkOrganizationMark[];
};

const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ORGANIZATION_ID = /^org:[a-z0-9][a-z0-9-]{0,127}$/;
const WORK_GROUP_ID = /^group:[a-z0-9][a-z0-9:-]{0,159}$/;
const ASSET_PATH = /^\/assets\/organizations\/[a-z0-9][a-z0-9-]*\.svg$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const groupIds = new Set<WorkOrganizationGroupId>(
  workOrganizationGroupDefinitions.map(({ id }) => id),
);

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    Object.keys(value).every((key) => expected.includes(key))
  );
}

function uniqueStrings(
  value: unknown,
  pattern: RegExp,
  maximumEntries: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximumEntries &&
    value.every((entry) => typeof entry === "string" && pattern.test(entry)) &&
    new Set(value).size === value.length
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseLogo(value: unknown): WorkOrganizationLogo | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("work_organization_logo_invalid");
  }
  const logo = value as Record<string, unknown>;
  if (
    !exactKeys(logo, ["assetPath", "sourceUrl", "lastVerified"]) ||
    typeof logo.assetPath !== "string" ||
    !ASSET_PATH.test(logo.assetPath) ||
    typeof logo.sourceUrl !== "string" ||
    !isHttpsUrl(logo.sourceUrl) ||
    typeof logo.lastVerified !== "string" ||
    !isIsoCalendarDate(logo.lastVerified)
  ) {
    throw new Error("work_organization_logo_invalid");
  }
  return logo as WorkOrganizationLogo;
}

export function parseWorkOrganizationManifest(
  value: unknown,
): WorkOrganizationManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("work_organization_manifest_invalid");
  }
  const manifest = value as Record<string, unknown>;
  if (
    !exactKeys(manifest, ["schemaVersion", "marks"]) ||
    manifest.schemaVersion !== "1.0" ||
    !Array.isArray(manifest.marks) ||
    manifest.marks.length === 0
  ) {
    throw new Error("work_organization_manifest_invalid");
  }

  const marks = manifest.marks.map((value): WorkOrganizationMark => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("work_organization_mark_invalid");
    }
    const mark = value as Record<string, unknown>;
    if (
      !exactKeys(mark, [
        "id",
        "name",
        "group",
        "secondaryGroups",
        "sourceOrganizationIds",
        "workGroupIds",
        "featuredOrder",
        "logo",
      ]) ||
      typeof mark.id !== "string" ||
      !IDENTIFIER.test(mark.id) ||
      typeof mark.name !== "string" ||
      mark.name.length < 2 ||
      mark.name.length > 80 ||
      typeof mark.group !== "string" ||
      !groupIds.has(mark.group as WorkOrganizationGroupId) ||
      !Array.isArray(mark.secondaryGroups) ||
      mark.secondaryGroups.some(
        (group) =>
          typeof group !== "string" ||
          !groupIds.has(group as WorkOrganizationGroupId) ||
          group === mark.group,
      ) ||
      new Set(mark.secondaryGroups).size !== mark.secondaryGroups.length ||
      !uniqueStrings(mark.sourceOrganizationIds, ORGANIZATION_ID, 32) ||
      !uniqueStrings(mark.workGroupIds, WORK_GROUP_ID, 128) ||
      !Number.isSafeInteger(mark.featuredOrder) ||
      (mark.featuredOrder as number) < 1
    ) {
      throw new Error("work_organization_mark_invalid");
    }

    return {
      id: mark.id,
      name: mark.name,
      group: mark.group as WorkOrganizationGroupId,
      secondaryGroups: [
        ...(mark.secondaryGroups as WorkOrganizationGroupId[]),
      ],
      sourceOrganizationIds: [...(mark.sourceOrganizationIds as string[])],
      workGroupIds: [...(mark.workGroupIds as string[])],
      featuredOrder: mark.featuredOrder as number,
      logo: parseLogo(mark.logo),
    };
  });

  if (
    new Set(marks.map(({ id }) => id)).size !== marks.length ||
    new Set(marks.map(({ featuredOrder }) => featuredOrder)).size !==
      marks.length
  ) {
    throw new Error("work_organization_manifest_duplicate");
  }

  return { schemaVersion: "1.0", marks };
}

const workOrganizationManifest = parseWorkOrganizationManifest(manifestJson);

/**
 * Strictly validates the checked-in presentation contract against a complete,
 * sanitized public bundle. Call this in content tests and publication checks.
 */
export function validateWorkOrganizationManifest(
  bundle: AnishContentBundle,
  value: unknown = manifestJson,
): WorkOrganizationManifest {
  const manifest = parseWorkOrganizationManifest(value);
  const organizationIds = new Set(
    bundle.organizations.map(({ id }) => id),
  );
  const workGroupById = new Map(
    (bundle.workGroups ?? []).map((group) => [group.id, group]),
  );

  for (const mark of manifest.marks) {
    for (const organizationId of mark.sourceOrganizationIds) {
      if (!organizationIds.has(organizationId)) {
        throw new Error(
          `work_organization_source_missing:${mark.id}:${organizationId}`,
        );
      }
    }

    for (const workGroupId of mark.workGroupIds) {
      const group = workGroupById.get(workGroupId);
      if (!group) {
        throw new Error(
          `work_organization_group_missing:${mark.id}:${workGroupId}`,
        );
      }
      if (!supportsMark(group, mark)) {
        throw new Error(
          `work_organization_evidence_missing:${mark.id}:${workGroupId}`,
        );
      }
    }
  }

  return manifest;
}

/**
 * Resolves marks against the active publication. WorkGroups absent from the
 * selected D1 publication are treated as hidden, not as evidence failures.
 */
export function workOrganizationMarksFrom(
  bundle: AnishContentBundle,
): ResolvedWorkOrganizationMark[] {
  const activeWorkGroupById = new Map(
    (bundle.workGroups ?? [])
      .filter((group) => group.publicationState === "public")
      .map((group) => [group.id, group]),
  );

  return workOrganizationManifest.marks
    .flatMap((mark): ResolvedWorkOrganizationMark[] => {
      const visibleWorkGroupIds = mark.workGroupIds.filter((id) => {
        const group = activeWorkGroupById.get(id);
        if (!group) return false;
        if (!supportsMark(group, mark)) {
          throw new Error(
            `work_organization_evidence_missing:${mark.id}:${id}`,
          );
        }
        return true;
      });
      if (!visibleWorkGroupIds.length) return [];
      return [
        {
          ...mark,
          secondaryGroups: [...mark.secondaryGroups],
          sourceOrganizationIds: [...mark.sourceOrganizationIds],
          workGroupIds: visibleWorkGroupIds,
          projectCount: visibleWorkGroupIds.length,
        },
      ];
    })
    .sort((left, right) => left.featuredOrder - right.featuredOrder);
}

export function workOrganizationSectionsFrom(
  bundle: AnishContentBundle,
): ResolvedWorkOrganizationSection[] {
  const marks = workOrganizationMarksFrom(bundle);
  return workOrganizationGroupDefinitions.map(({ id, label }) => ({
    id,
    label,
    marks: marks.filter((mark) => mark.group === id),
  }));
}

export function workOrganizationMarkIdsByGroupFrom(
  bundle: AnishContentBundle,
): Map<string, string[]> {
  const idsByGroup = new Map<string, string[]>();
  for (const mark of workOrganizationMarksFrom(bundle)) {
    for (const workGroupId of mark.workGroupIds) {
      const current = idsByGroup.get(workGroupId) ?? [];
      idsByGroup.set(workGroupId, [...current, mark.id]);
    }
  }
  return idsByGroup;
}

export function workOrganizationLabelForId(id: string): string | undefined {
  return workOrganizationManifest.marks.find((mark) => mark.id === id)?.name;
}

function supportsMark(group: WorkGroup, mark: WorkOrganizationMark): boolean {
  const sourceOrganizationIds = new Set(mark.sourceOrganizationIds);
  return group.organizationIds.some((id) => sourceOrganizationIds.has(id));
}
