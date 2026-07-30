import type {
  AnishContentBundle,
  PortfolioItem,
  PublicImpactMetric,
  WorkGroup,
} from "@/types/content";
import { validatePublicProjection } from "./editorial-policy";

export type PublishedEditorialRecord = {
  id: string;
  recordType: string;
  slug: string | null;
  title: string;
  summary: string;
  approvedPublicWording: string;
  caveat: string;
  featured: boolean;
  sortOrder: number;
  verificationState: string;
  evidenceAccess: "public_web";
  publicPayload: unknown;
};

export type PublishedEditorialSnapshot = {
  schemaVersion: "1.1";
  baseContentVersion: string;
  publishedAt: string;
  contentHash: string;
  records: PublishedEditorialRecord[];
};

export type PublishedSnapshotRow = {
  snapshotJson: string;
  contentHash: string;
};

export type ResolvedPublicContent = {
  bundle: AnishContentBundle;
  source: "published_snapshot" | "static_fallback";
  publishedAt: string | null;
};

const RECORD_KEYS = new Set([
  "id",
  "recordType",
  "slug",
  "title",
  "summary",
  "approvedPublicWording",
  "caveat",
  "featured",
  "sortOrder",
  "verificationState",
  "evidenceAccess",
  "publicPayload",
]);

function isPublishedRecord(value: unknown): value is PublishedEditorialRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !RECORD_KEYS.has(key)) ||
    Object.keys(record).length !== RECORD_KEYS.size
  ) {
    return false;
  }

  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    record.id.length <= 240 &&
    typeof record.recordType === "string" &&
    (record.slug === null || typeof record.slug === "string") &&
    typeof record.title === "string" &&
    typeof record.summary === "string" &&
    typeof record.approvedPublicWording === "string" &&
    record.approvedPublicWording.length <= 600 &&
    typeof record.caveat === "string" &&
    record.caveat.length <= 600 &&
    typeof record.featured === "boolean" &&
    typeof record.sortOrder === "number" &&
    Number.isInteger(record.sortOrder) &&
    record.sortOrder >= -100_000 &&
    record.sortOrder <= 100_000 &&
    typeof record.verificationState === "string" &&
    record.evidenceAccess === "public_web" &&
    validatePublicProjection(record, `published:${record.id}`).ok
  );
}

export function parsePublishedEditorialSnapshot(
  value: unknown,
): PublishedEditorialSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const snapshot = value as Record<string, unknown>;
  if (
    Object.keys(snapshot).length !== 5 ||
    ![
      "schemaVersion",
      "baseContentVersion",
      "publishedAt",
      "contentHash",
      "records",
    ].every((key) => Object.hasOwn(snapshot, key)) ||
    snapshot.schemaVersion !== "1.1" ||
    typeof snapshot.baseContentVersion !== "string" ||
    !/^[a-f0-9]{16}$/.test(snapshot.baseContentVersion) ||
    typeof snapshot.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.publishedAt)) ||
    typeof snapshot.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(snapshot.contentHash) ||
    !Array.isArray(snapshot.records) ||
    snapshot.records.length > 10_000 ||
    !snapshot.records.every(isPublishedRecord)
  ) {
    return null;
  }

  const records = snapshot.records as PublishedEditorialRecord[];
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    return null;
  }

  return {
    schemaVersion: "1.1",
    baseContentVersion: snapshot.baseContentVersion,
    publishedAt: snapshot.publishedAt,
    contentHash: snapshot.contentHash,
    records,
  };
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  return copied.buffer;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function publishedRecordsHash(
  records: unknown[],
  baseContentVersion: string,
): Promise<string> {
  const canonical = JSON.stringify({
    schemaVersion: "1.1",
    baseContentVersion,
    records,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    asArrayBuffer(new TextEncoder().encode(canonical)),
  );
  return toHex(new Uint8Array(digest));
}

function withCaveat(
  primary: string | null,
  caveat: string,
): string | null {
  const base = primary?.trim() ?? "";
  const qualifier = caveat.trim();
  if (!base) return qualifier || null;
  if (!qualifier || base.includes(qualifier)) return base;
  return `${base} — ${qualifier}`;
}

function metricLabel(
  metric: PublicImpactMetric,
  approvedWording: string,
): string {
  const wording = approvedWording.trim();
  if (!wording) return metric.label;
  const display = metric.displayValue.trim();
  if (wording.toLocaleLowerCase().startsWith(display.toLocaleLowerCase())) {
    const remainder = wording.slice(display.length).trim().replace(/^[-—:]\s*/, "");
    return remainder || metric.label;
  }
  return wording;
}

function orderByPublished<T extends { id: string }>(
  values: T[],
  records: Map<string, PublishedEditorialRecord>,
): T[] {
  const stableIndex = new Map(values.map((value, index) => [value.id, index]));
  return [...values].sort((left, right) => {
    const leftOrder = records.get(left.id)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder =
      records.get(right.id)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    return (
      leftOrder - rightOrder ||
      (stableIndex.get(left.id) ?? 0) - (stableIndex.get(right.id) ?? 0)
    );
  });
}

/**
 * The checked-in public bundle remains the only source of substantive record
 * data. D1 can hide/reorder/feature records and replace reviewed public wording
 * or caveats, but it cannot introduce records, URLs, evidence, or private data.
 */
export function mergePublishedEditorialSnapshot(
  staticBundle: AnishContentBundle,
  snapshot: PublishedEditorialSnapshot,
): AnishContentBundle | null {
  if (snapshot.baseContentVersion !== staticBundle.contentVersion) return null;
  const records = new Map(snapshot.records.map((record) => [record.id, record]));

  for (const record of snapshot.records) {
    const item = staticBundle.items.find((candidate) => candidate.id === record.id);
    const metric = staticBundle.metrics.find(
      (candidate) => candidate.id === record.id,
    );
    const narrative = staticBundle.narratives.find(
      (candidate) => candidate.id === record.id,
    );
    const workGroup = staticBundle.workGroups.find(
      (candidate) => candidate.id === record.id,
    );
    const expectedType = item
      ? item.type
      : metric
        ? "metric"
        : narrative
          ? "narrative"
          : workGroup
            ? "work_group"
            : null;
    if (!expectedType || record.recordType !== expectedType) return null;
  }

  const items = orderByPublished(
    staticBundle.items.flatMap((item): PortfolioItem[] => {
      const record = records.get(item.id);
      if (!record) return [];
      return [
        {
          ...item,
          publicationState: "public",
          featured: record.featured,
          summary: withCaveat(
            record.approvedPublicWording || item.summary,
            record.caveat,
          ),
        },
      ];
    }),
    records,
  );

  const orderedMetrics = orderByPublished(
    staticBundle.metrics.flatMap((metric) => {
      if (!("displayValue" in metric)) return [];
      const record = records.get(metric.id);
      if (!record) return [];
      const publicMetric: PublicImpactMetric = {
        ...metric,
        publicationState: "public",
        label: metricLabel(metric, record.approvedPublicWording),
        qualifier: record.caveat.trim() || metric.qualifier,
      };
      return [publicMetric];
    }),
    records,
  );

  const narratives = orderByPublished(
    staticBundle.narratives.flatMap((narrative) => {
      const record = records.get(narrative.id);
      if (!record) return [];
      return [
        {
          ...narrative,
          publicationState: "public" as const,
          body:
            withCaveat(
              record.approvedPublicWording || narrative.body,
              record.caveat,
            ) ?? narrative.body,
        },
      ];
    }),
    records,
  );

  const itemIds = new Set(items.map((item) => item.id));
  const candidateWorkGroups = orderByPublished(
    staticBundle.workGroups.flatMap((group): WorkGroup[] => {
      const record = records.get(group.id);
      if (!record) return [];
      const visibleItemIds = group.itemIds.filter((id) => itemIds.has(id));
      if (!visibleItemIds.length) return [];
      return [
        {
          ...group,
          itemIds: visibleItemIds,
          featuredOrder: record.featured ? record.sortOrder : null,
          summary:
            withCaveat(
              record.approvedPublicWording || group.summary,
              record.caveat,
            ) ?? group.summary,
        },
      ];
    }),
    records,
  );
  const requiredEntityIds = new Set([
    ...items.map((item) => item.canonicalEntityId),
    ...orderedMetrics
      .map((metric) => metric.subjectId)
      .filter((id) => staticBundle.entities.some((entity) => entity.id === id)),
    ...candidateWorkGroups.flatMap((group) => [
      ...group.memberEntityIds,
      ...group.programEntityIds,
      ...group.contextEntityIds,
    ]),
  ]);
  for (const entity of staticBundle.entities) {
    if (
      entity.itemIds.some((id) => itemIds.has(id)) ||
      entity.parentEntityIds.some((id) => requiredEntityIds.has(id))
    ) {
      requiredEntityIds.add(entity.id);
      for (const parentId of entity.parentEntityIds) requiredEntityIds.add(parentId);
    }
  }
  const entities = staticBundle.entities
    .filter((entity) => requiredEntityIds.has(entity.id))
    .map((entity) => {
      const entityItemIds = entity.itemIds.filter((id) => itemIds.has(id));
      return {
        ...entity,
        itemIds: entityItemIds,
        primaryItemId:
          entity.primaryItemId && itemIds.has(entity.primaryItemId)
            ? entity.primaryItemId
            : entityItemIds[0] ?? null,
        parentEntityIds: entity.parentEntityIds.filter((id) =>
          requiredEntityIds.has(id),
        ),
        childCounts: {
          ...entity.childCounts,
          items: entityItemIds.length,
        },
      };
    });
  const entityIds = new Set(entities.map((entity) => entity.id));
  const visibleEntityItems = new Map(
    entities.map((entity) => [entity.id, new Set(entity.itemIds)]),
  );
  const workGroups = candidateWorkGroups.flatMap((group): WorkGroup[] => {
    const memberEntityIds = group.memberEntityIds.filter((id) => {
      const entityItemIds = visibleEntityItems.get(id);
      return (
        entityIds.has(id) &&
        entityItemIds !== undefined &&
        group.itemIds.some((itemId) => entityItemIds.has(itemId))
      );
    });
    const primaryEntityId = memberEntityIds.includes(group.primaryEntityId)
      ? group.primaryEntityId
      : memberEntityIds[0];
    if (!primaryEntityId || !group.itemIds.length) return [];
    return [
      {
        ...group,
        primaryEntityId,
        memberEntityIds,
        programEntityIds: group.programEntityIds.filter(
          (id) => entityIds.has(id) && (visibleEntityItems.get(id)?.size ?? 0) > 0,
        ),
        contextEntityIds: group.contextEntityIds.filter(
          (id) => entityIds.has(id) && (visibleEntityItems.get(id)?.size ?? 0) > 0,
        ),
      },
    ];
  });
  const workGroupIds = new Set(workGroups.map((group) => group.id));
  const metrics = orderedMetrics.filter(
    (metric) => {
      if (metric.subjectId.startsWith("group:")) {
        return workGroupIds.has(metric.subjectId);
      }
      if (metric.subjectId.startsWith("item:")) {
        return itemIds.has(metric.subjectId);
      }
      if (metric.subjectId.startsWith("entity:")) {
        return (
          entityIds.has(metric.subjectId) &&
          (visibleEntityItems.get(metric.subjectId)?.size ?? 0) > 0
        );
      }
      return true;
    },
  );
  const metricIds = new Set(metrics.map((metric) => metric.id));
  const referencedEvidenceIds = new Set([
    ...items.flatMap((item) => item.evidenceIds),
    ...metrics.flatMap((metric) => metric.publicEvidenceIds),
  ]);

  return {
    ...staticBundle,
    items,
    entities,
    workGroups,
    metrics,
    metricGroups: staticBundle.metricGroups
      .map((group) => {
        const visibleMetricIds = group.metricIds.filter((id) =>
          metricIds.has(id),
        );
        return {
          ...group,
          metricIds: visibleMetricIds,
          leadMetricId: metricIds.has(group.leadMetricId)
            ? group.leadMetricId
            : (visibleMetricIds[0] ?? group.leadMetricId),
        };
      })
      .filter((group) => group.metricIds.length > 0),
    narratives,
    relations: staticBundle.relations.filter(
      (relation) =>
        itemIds.has(relation.fromId) && itemIds.has(relation.toId),
    ),
    collections: staticBundle.collections.map((collection) => ({
      ...collection,
      itemIds: collection.itemIds.filter((id) => itemIds.has(id)),
      metricIds: collection.metricIds.filter((id) => metricIds.has(id)),
    })),
    evidence: staticBundle.evidence.filter(
      (source) =>
        source.kind === "methodology" ||
        referencedEvidenceIds.has(source.id),
    ),
    sourceSummary: {
      ...staticBundle.sourceSummary,
      approvedMetricCount: metrics.length,
    },
  };
}

export async function resolvePublicContentFromSnapshotRow(
  staticBundle: AnishContentBundle,
  row: PublishedSnapshotRow | null,
): Promise<ResolvedPublicContent> {
  if (!row) {
    return {
      bundle: staticBundle,
      source: "static_fallback",
      publishedAt: null,
    };
  }

  try {
    const parsed = parsePublishedEditorialSnapshot(JSON.parse(row.snapshotJson));
    if (
      !parsed ||
      parsed.baseContentVersion !== staticBundle.contentVersion ||
      parsed.contentHash !== row.contentHash ||
      (await publishedRecordsHash(
        parsed.records,
        parsed.baseContentVersion,
      )) !== row.contentHash
    ) {
      return {
        bundle: staticBundle,
        source: "static_fallback",
        publishedAt: null,
      };
    }

    const merged = mergePublishedEditorialSnapshot(staticBundle, parsed);
    return merged
      ? {
          bundle: merged,
          source: "published_snapshot",
          publishedAt: parsed.publishedAt,
        }
      : {
          bundle: staticBundle,
          source: "static_fallback",
          publishedAt: null,
        };
  } catch {
    return {
      bundle: staticBundle,
      source: "static_fallback",
      publishedAt: null,
    };
  }
}
