export type PublicRecordSeedRecord = {
  id: string;
  recordType: string;
  slug: string | null;
  title: string;
  summary: string;
  approvedPublicWording: string;
  caveat: string;
  publicPayloadJson: string;
  publicationState: string;
  verificationState: string;
  evidenceAccess: "public_web";
  featured: boolean;
  sortOrder: number;
};

export const PUBLIC_RECORD_SEED_VERSION = 2;
const MAX_BOUND_JSON_BYTES = 192 * 1024;
// Keep bootstrap comfortably below D1 Free's 50-query Worker invocation
// ceiling, leaving room for reconciliation and publication in the same POST.
export const PUBLIC_RECORD_SEED_STATEMENT_BUDGET = 16;
const textEncoder = new TextEncoder();

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function isCurrentPublicRecordSeedMetadata(
  value: unknown,
  contentVersion: string,
  recordCount: number,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const metadata = value as Record<string, unknown>;
  return (
    metadata.seedVersion === PUBLIC_RECORD_SEED_VERSION &&
    metadata.contentVersion === contentVersion &&
    metadata.recordCount === recordCount
  );
}

function serializeBoundedArrays<T>(values: readonly T[]): string[] {
  const chunks: string[] = [];
  let entries: string[] = [];
  let bytes = 2;

  for (const value of values) {
    const entry = JSON.stringify(value);
    const entryBytes = byteLength(entry);
    if (entryBytes + 2 > MAX_BOUND_JSON_BYTES) {
      throw new Error("A public record exceeds the bounded D1 seed payload size.");
    }

    const separatorBytes = entries.length === 0 ? 0 : 1;
    if (
      entries.length > 0 &&
      bytes + separatorBytes + entryBytes > MAX_BOUND_JSON_BYTES
    ) {
      chunks.push(`[${entries.join(",")}]`);
      entries = [];
      bytes = 2;
    }

    entries.push(entry);
    bytes += (entries.length === 1 ? 0 : 1) + entryBytes;
  }

  if (entries.length > 0) {
    chunks.push(`[${entries.join(",")}]`);
  }

  return chunks;
}

export function canonicalItemSeedSlug(
  itemId: string,
  itemSlug: string,
  nestedItemIds: ReadonlySet<string>,
): string | null {
  return nestedItemIds.has(itemId) ? null : itemSlug;
}

export function assertUniquePublicRecordSeedKeys(
  records: readonly PublicRecordSeedRecord[],
): void {
  const ids = new Set<string>();
  const slugs = new Map<string, string>();

  for (const record of records) {
    if (!record.id || ids.has(record.id)) {
      throw new Error("Sanitized public records must have unique non-empty IDs.");
    }
    ids.add(record.id);

    if (record.slug === null) continue;
    if (!record.slug) {
      throw new Error("Sanitized public record slugs cannot be empty.");
    }
    const owner = slugs.get(record.slug);
    if (owner) {
      throw new Error(
        `Sanitized public record slug has multiple owners: ${record.slug}.`,
      );
    }
    slugs.set(record.slug, record.id);
  }
}

const RELEASE_CONFLICTING_SLUGS_SQL = `
  WITH desired_slugs AS (
    SELECT
      json_extract(entry.value, '$.id') AS id,
      json_extract(entry.value, '$.slug') AS slug
    FROM json_each(?) AS entry
  )
  UPDATE public_records
  SET slug = NULL, updated_at = ?
  WHERE slug IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM desired_slugs
      WHERE desired_slugs.slug = public_records.slug
        AND desired_slugs.id <> public_records.id
    )`;

const BULK_UPSERT_SQL = `
  INSERT INTO public_records (
    id, record_type, slug, title, summary,
    approved_public_wording, public_caveat, public_payload_json,
    publication_state, verification_state, evidence_access,
    featured, sort_order, updated_at
  )
  SELECT
    json_extract(entry.value, '$.id'),
    json_extract(entry.value, '$.recordType'),
    json_extract(entry.value, '$.slug'),
    json_extract(entry.value, '$.title'),
    json_extract(entry.value, '$.summary'),
    json_extract(entry.value, '$.approvedPublicWording'),
    json_extract(entry.value, '$.caveat'),
    json_extract(entry.value, '$.publicPayloadJson'),
    json_extract(entry.value, '$.publicationState'),
    json_extract(entry.value, '$.verificationState'),
    json_extract(entry.value, '$.evidenceAccess'),
    CASE WHEN json_extract(entry.value, '$.featured') = 1 THEN 1 ELSE 0 END,
    json_extract(entry.value, '$.sortOrder'),
    ?
  FROM json_each(?) AS entry
  WHERE 1
  ON CONFLICT(id) DO UPDATE SET
    record_type = excluded.record_type,
    slug = excluded.slug,
    title = excluded.title,
    summary = excluded.summary,
    public_payload_json = excluded.public_payload_json,
    verification_state = excluded.verification_state,
    evidence_access = excluded.evidence_access,
    updated_at = excluded.updated_at`;

export async function bulkUpsertPublicRecordSeeds(
  database: D1Database,
  records: readonly PublicRecordSeedRecord[],
  importedAt: string,
): Promise<{ statementCount: number }> {
  assertUniquePublicRecordSeedKeys(records);
  if (records.length === 0) return { statementCount: 0 };

  const slugOwners = records.flatMap((record) =>
    record.slug === null ? [] : [{ id: record.id, slug: record.slug }],
  );
  const ownerChunks = serializeBoundedArrays(slugOwners);
  const recordChunks = serializeBoundedArrays(records);
  const statements = [
    ...ownerChunks.map((chunk) =>
      database
        .prepare(RELEASE_CONFLICTING_SLUGS_SQL)
        .bind(chunk, importedAt),
    ),
    ...recordChunks.map((chunk) =>
      database.prepare(BULK_UPSERT_SQL).bind(importedAt, chunk),
    ),
  ];

  if (statements.length > PUBLIC_RECORD_SEED_STATEMENT_BUDGET) {
    throw new Error("Sanitized public import exceeds the D1 seed query budget.");
  }

  await database.batch(statements);
  return { statementCount: statements.length };
}
