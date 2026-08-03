import publicBundleJson from "@/content/public/anish-content.public.v1.json";
import { validatePublicProjection } from "./editorial-policy";
import {
  bulkUpsertPublicRecordSeeds,
  canonicalItemSeedSlug,
  isCurrentPublicRecordSeedMetadata,
  PUBLIC_RECORD_SEED_VERSION,
  type PublicRecordSeedRecord,
} from "./public-record-seed-bulk";
import { reconcileStalePublicRecords } from "./public-record-reconciliation";
import { runtimeDatabase } from "./runtime-env";

type PublicEvidence = {
  id: string;
  title: string;
  kind: string;
  access: "public_web";
  url?: string;
  publisher?: string;
  capturedAt: string;
  verificationState: string;
};

type PublicBundle = {
  contentVersion: string;
  organizations: Array<{ id: string; name: string }>;
  evidence: PublicEvidence[];
  items: Array<{
    id: string;
    slug: string;
    type: string;
    title: string;
    summary: string | null;
    publicationState: string;
    verificationState: string;
    featured: boolean;
    organizationIds: string[];
    evidenceIds: string[];
    date: { start: string | null };
    additionalDates: unknown;
    year: number | null;
    role: string;
    location: unknown;
    status: string;
    urls: unknown;
    topics: string[];
    durationSeconds: number | null;
  }>;
  metrics: Array<{
    id: string;
    subjectId: string;
    category: string;
    key: string;
    displayValue: string;
    label: string;
    qualifier: string | null;
    period: unknown;
    sourceLabel: string;
    publicationState: string;
    verificationState: string;
    publicEvidenceIds: string[];
  }>;
  narratives: Array<{
    id: string;
    title: string;
    body: string;
    placement: string;
    publicationState: string;
  }>;
  workGroups: Array<{
    id: string;
    slug: string;
    title: string;
    shortTitle: string;
    summary: string;
    bucket: string;
    featuredOrder: number | null;
    period: unknown;
    publicationState: string;
    verificationState: string;
    itemIds: string[];
  }>;
};

const publicBundle = publicBundleJson as unknown as PublicBundle;
const expectedSeedRecordCount =
  publicBundle.items.length +
  publicBundle.metrics.length +
  publicBundle.narratives.length +
  publicBundle.workGroups.length;

function safeState(value: string): string {
  return ["public", "review_required", "private", "excluded"].includes(value)
    ? value
    : "review_required";
}

function seedRecords(): PublicRecordSeedRecord[] {
  const organizations = new Map(
    publicBundle.organizations.map((organization) => [
      organization.id,
      organization,
    ]),
  );
  const evidence = new Map(
    publicBundle.evidence.map((source) => [source.id, source]),
  );
  // A WorkGroup is the canonical public route. Nested forms keep their legacy
  // slugs in the sanitized bundle for redirects, but do not compete for the
  // globally unique editorial slug in D1.
  const nestedItemIds = new Set(
    publicBundle.workGroups.flatMap((group) => group.itemIds),
  );

  const defaultItemOrder = new Map(
    [...publicBundle.items]
      .sort(
        (left, right) =>
          (right.date.start ?? "").localeCompare(left.date.start ?? "") ||
          right.title.localeCompare(left.title),
      )
      .map((item, index) => [item.id, index]),
  );

  const itemRecords = publicBundle.items.map(
    (item): PublicRecordSeedRecord => {
      const publicPayload = {
        date: item.date,
        additionalDates: item.additionalDates,
        year: item.year,
        role: item.role,
        organizations: item.organizationIds.flatMap((id) => {
          const organization = organizations.get(id);
          return organization ? [organization] : [];
        }),
        location: item.location,
        status: item.status,
        urls: item.urls,
        topics: item.topics,
        durationSeconds: item.durationSeconds,
        publicEvidence: item.evidenceIds.flatMap((id) => {
          const source = evidence.get(id);
          return source ? [source] : [];
        }),
      };

      return {
        id: item.id,
        recordType: item.type,
        slug: canonicalItemSeedSlug(item.id, item.slug, nestedItemIds),
        title: item.title,
        summary: item.summary ?? "",
        approvedPublicWording: "",
        caveat: "",
        publicPayloadJson: JSON.stringify(publicPayload),
        publicationState: safeState(item.publicationState),
        verificationState: item.verificationState,
        evidenceAccess: "public_web",
        featured: item.featured,
        sortOrder: defaultItemOrder.get(item.id) ?? 0,
      };
    },
  );

  const metricRecords = publicBundle.metrics.map(
    (metric, index): PublicRecordSeedRecord => {
      const wording = `${metric.displayValue} ${metric.label}`.trim();
      const publicPayload = {
        subjectId: metric.subjectId,
        category: metric.category,
        key: metric.key,
        displayValue: metric.displayValue,
        label: metric.label,
        qualifier: metric.qualifier,
        period: metric.period,
        sourceLabel: metric.sourceLabel,
        publicEvidence: metric.publicEvidenceIds.flatMap((id) => {
          const source = evidence.get(id);
          return source ? [source] : [];
        }),
      };

      return {
        id: metric.id,
        recordType: "metric",
        slug: null,
        title: wording,
        summary: metric.qualifier ?? "",
        approvedPublicWording: wording,
        caveat: metric.qualifier ?? "",
        publicPayloadJson: JSON.stringify(publicPayload),
        publicationState: safeState(metric.publicationState),
        verificationState: metric.verificationState,
        evidenceAccess: "public_web",
        featured: false,
        sortOrder: 10_000 + index,
      };
    },
  );

  const narrativeRecords = publicBundle.narratives.map(
    (narrative, index): PublicRecordSeedRecord => ({
      id: narrative.id,
      recordType: "narrative",
      slug: null,
      title: narrative.title,
      summary: narrative.body,
      approvedPublicWording: "",
      caveat: "",
      publicPayloadJson: JSON.stringify({ placement: narrative.placement }),
      publicationState: safeState(narrative.publicationState),
      verificationState: "verified",
      evidenceAccess: "public_web",
      featured: false,
      sortOrder: 20_000 + index,
    }),
  );

  const workGroupRecords = publicBundle.workGroups.map(
    (group, index): PublicRecordSeedRecord => ({
      id: group.id,
      recordType: "work_group",
      slug: group.slug,
      title: group.title,
      summary: group.summary,
      approvedPublicWording: group.summary,
      caveat: "",
      publicPayloadJson: JSON.stringify({
        bucket: group.bucket,
        shortTitle: group.shortTitle,
        period: group.period,
      }),
      publicationState: safeState(group.publicationState),
      verificationState: group.verificationState,
      evidenceAccess: "public_web",
      featured: group.featuredOrder !== null,
      sortOrder: group.featuredOrder ?? 30_000 + index,
    }),
  );

  return [
    ...itemRecords,
    ...metricRecords,
    ...narrativeRecords,
    ...workGroupRecords,
  ];
}

export async function ensureSanitizedPublicRecords(
  actorEmail: string,
): Promise<{ status: "current" | "imported"; count: number }> {
  const binding = runtimeDatabase();
  if (!binding) {
    throw new Error("D1 database binding is unavailable.");
  }

  const current = await binding
    .prepare(
      `SELECT value_json AS valueJson
       FROM editorial_settings
       WHERE key = 'content.seed_version'
       LIMIT 1`,
    )
    .first<{ valueJson: string }>();
  if (current?.valueJson) {
    try {
      const value: unknown = JSON.parse(current.valueJson);
      if (
        isCurrentPublicRecordSeedMetadata(
          value,
          publicBundle.contentVersion,
          expectedSeedRecordCount,
        )
      ) {
        const count = await binding
          .prepare(`SELECT COUNT(*) AS count FROM public_records`)
          .first<{ count: number }>();
        const actualCount = Number(count?.count) || 0;
        if (actualCount === expectedSeedRecordCount) {
          return { status: "current", count: actualCount };
        }
        // A valid marker cannot mask a deleted or partially restored row set.
        // Fall through to the idempotent import and repair it.
      }
    } catch {
      // Invalid seed metadata is repaired by the idempotent import below.
    }
  }

  const records = seedRecords();
  for (const record of records) {
    const validation = validatePublicProjection(
      {
        id: record.id,
        recordType: record.recordType,
        slug: record.slug,
        title: record.title,
        summary: record.summary,
        approvedPublicWording: record.approvedPublicWording,
        caveat: record.caveat,
        publicPayload: JSON.parse(record.publicPayloadJson),
      },
      `seed:${record.id}`,
    );
    if (!validation.ok) {
      throw new Error(`Sanitized content import rejected: ${validation.message}`);
    }
  }

  const importedAt = new Date().toISOString();
  await bulkUpsertPublicRecordSeeds(binding, records, importedAt);

  const recordIds = new Set(records.map((record) => record.id));
  await reconcileStalePublicRecords(binding, recordIds, importedAt);

  await binding.batch([
    binding
      .prepare(
        `INSERT INTO editorial_settings (
           key, value_json, updated_by_email, updated_at
         ) VALUES ('content.seed_version', ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_by_email = excluded.updated_by_email,
           updated_at = excluded.updated_at`,
      )
      .bind(
        JSON.stringify({
          seedVersion: PUBLIC_RECORD_SEED_VERSION,
          contentVersion: publicBundle.contentVersion,
          recordCount: records.length,
        }),
        actorEmail,
        importedAt,
      ),
    binding
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, 'editorial.public_projection_imported',
                   'content_version', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        publicBundle.contentVersion,
        JSON.stringify({ recordCount: records.length }),
        importedAt,
      ),
  ]);

  return { status: "imported", count: records.length };
}
