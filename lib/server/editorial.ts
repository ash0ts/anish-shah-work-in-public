import publicBundleJson from "@/content/public/anish-content.public.v1.json";
import { runtimeDatabase } from "./runtime-env";
import {
  type EditorialRecordPatch,
  type EditorialVisibility,
  validatePublicProjection,
} from "./editorial-policy";

export type EditorialRecord = {
  id: string;
  recordType: string;
  slug: string | null;
  title: string;
  summary: string;
  featured: boolean;
  sortOrder: number;
  approvedPublicWording: string;
  caveat: string;
  visibility: EditorialVisibility;
  verificationState: string;
  updatedAt: string;
  revision: string;
};

export type EditorialRecordList = {
  records: EditorialRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

export type EditorialListOptions = {
  limit: number;
  offset: number;
  visibility?: EditorialVisibility;
  recordType?: string;
  query?: string;
};

export class EditorialError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "EditorialError";
    this.code = code;
    this.status = status;
  }
}

type EditorialRow = {
  id: string;
  recordType: string;
  slug: string | null;
  title: string;
  summary: string;
  featured: number | boolean;
  sortOrder: number;
  approvedPublicWording: string;
  publicCaveat: string;
  publicationState: EditorialVisibility;
  verificationState: string;
  updatedAt: string;
};

type PublicRecordRow = EditorialRow & {
  publicPayloadJson: string;
  evidenceAccess: string;
};

function database(): D1Database {
  const binding = runtimeDatabase();
  if (!binding) {
    throw new EditorialError(
      "database_unavailable",
      "The site database is not ready.",
      503,
    );
  }
  return binding;
}

function mapEditorialRecord(row: EditorialRow): EditorialRecord {
  return {
    id: row.id,
    recordType: row.recordType,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    featured: Boolean(row.featured),
    sortOrder: Number(row.sortOrder) || 0,
    approvedPublicWording: row.approvedPublicWording,
    caveat: row.publicCaveat,
    visibility: row.publicationState,
    verificationState: row.verificationState,
    updatedAt: row.updatedAt,
    revision: row.updatedAt,
  };
}

function likeQuery(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

const EDITORIAL_COLUMNS = `
  id, record_type AS recordType, slug, title, summary, featured,
  sort_order AS sortOrder,
  approved_public_wording AS approvedPublicWording,
  public_caveat AS publicCaveat,
  publication_state AS publicationState,
  verification_state AS verificationState,
  updated_at AS updatedAt
`;

const CURRENT_CONTENT_VERSION = (
  publicBundleJson as { contentVersion: string }
).contentVersion;

export async function listEditorialRecords(
  options: EditorialListOptions,
): Promise<EditorialRecordList> {
  const binding = database();
  const where: string[] = [];
  const values: Array<string | number | null> = [];

  if (options.visibility) {
    where.push("publication_state = ?");
    values.push(options.visibility);
  }
  if (options.recordType) {
    where.push("record_type = ?");
    values.push(options.recordType);
  }
  if (options.query) {
    where.push(
      "(title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')",
    );
    const query = likeQuery(options.query);
    values.push(query, query, query);
  }

  const predicate = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  const rowsStatement = binding
    .prepare(
      `SELECT ${EDITORIAL_COLUMNS}
       FROM public_records${predicate}
       ORDER BY featured DESC, sort_order ASC, title COLLATE NOCASE ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...values, options.limit, options.offset);
  const countStatement = binding
    .prepare(`SELECT COUNT(*) AS count FROM public_records${predicate}`)
    .bind(...values);
  const [rowsResult, countResult] = await binding.batch([
    rowsStatement,
    countStatement,
  ]);

  const rows = (rowsResult.results ?? []) as unknown as EditorialRow[];
  const countRow = (countResult.results?.[0] ?? { count: 0 }) as {
    count: number;
  };

  return {
    records: rows.map(mapEditorialRecord),
    pagination: {
      limit: options.limit,
      offset: options.offset,
      total: Number(countRow.count) || 0,
    },
  };
}

export async function patchEditorialRecord(
  id: string,
  patch: EditorialRecordPatch,
  changedFields: string[],
  expectedRevision: string,
  actorEmail: string,
): Promise<EditorialRecord> {
  const binding = database();
  const current = await binding
    .prepare(
      `SELECT ${EDITORIAL_COLUMNS}
       FROM public_records
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<EditorialRow>();
  if (!current) {
    throw new EditorialError("record_not_found", "Record not found.", 404);
  }
  if (current.updatedAt !== expectedRevision) {
    throw new EditorialError(
      "revision_conflict",
      "This record changed after it was loaded. Refresh before saving.",
      409,
    );
  }

  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.featured !== undefined) {
    assignments.push("featured = ?");
    values.push(patch.featured ? 1 : 0);
  }
  if (patch.sortOrder !== undefined) {
    assignments.push("sort_order = ?");
    values.push(patch.sortOrder);
  }
  if (patch.approvedPublicWording !== undefined) {
    assignments.push("approved_public_wording = ?");
    values.push(patch.approvedPublicWording);
  }
  if (patch.caveat !== undefined) {
    assignments.push("public_caveat = ?");
    values.push(patch.caveat);
  }
  if (patch.visibility !== undefined) {
    assignments.push("publication_state = ?");
    values.push(patch.visibility);
  }
  if (assignments.length === 0) {
    throw new EditorialError(
      "empty_patch",
      "At least one editable field is required.",
      400,
    );
  }

  const updatedAt = new Date().toISOString();
  const auditDetails = JSON.stringify({
    changedFields,
    previousVisibility: current.publicationState,
    nextVisibility: patch.visibility ?? current.publicationState,
  });
  const [updateResult] = await binding.batch([
    binding
      .prepare(
        `UPDATE public_records
         SET ${assignments.join(", ")}, updated_at = ?
         WHERE id = ? AND updated_at = ?`,
      )
      .bind(...values, updatedAt, id, expectedRevision),
    binding
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         )
         SELECT ?, ?, 'editorial.record_updated', 'public_record', ?, ?, ?
         WHERE changes() = 1 AND EXISTS (
           SELECT 1 FROM public_records WHERE id = ? AND updated_at = ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        id,
        auditDetails,
        updatedAt,
        id,
        updatedAt,
      ),
  ]);

  if ((updateResult.meta.changes ?? 0) !== 1) {
    throw new EditorialError(
      "revision_conflict",
      "This record changed while it was being saved. Refresh and try again.",
      409,
    );
  }

  const updated = await binding
    .prepare(
      `SELECT ${EDITORIAL_COLUMNS}
       FROM public_records
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<EditorialRow>();
  if (!updated) {
    throw new EditorialError(
      "record_unavailable",
      "The updated record could not be read.",
      500,
    );
  }

  return mapEditorialRecord(updated);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toHex(new Uint8Array(digest));
}

export type PublicationResult = {
  id: string;
  contentHash: string;
  recordCount: number;
  publishedAt: string;
};

export async function createPublicationSnapshot(
  actorEmail: string,
): Promise<PublicationResult> {
  const binding = database();
  const rowsResult = await binding
    .prepare(
      `SELECT ${EDITORIAL_COLUMNS},
              public_payload_json AS publicPayloadJson,
              evidence_access AS evidenceAccess
       FROM public_records
       WHERE publication_state = 'public'
       ORDER BY featured DESC, sort_order ASC, id ASC`,
    )
    .all<PublicRecordRow>();
  const rows = rowsResult.results ?? [];
  if (rows.length === 0) {
    throw new EditorialError(
      "nothing_to_publish",
      "There are no public records to publish.",
      409,
    );
  }

  const publishedAt = new Date().toISOString();
  const projection = rows.map((row) => {
    let publicPayload: unknown;
    try {
      publicPayload = JSON.parse(row.publicPayloadJson);
    } catch {
      throw new EditorialError(
        "invalid_public_payload",
        `Record ${row.id} has invalid public JSON.`,
        409,
      );
    }

    const publicRecord = {
      id: row.id,
      recordType: row.recordType,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      approvedPublicWording: row.approvedPublicWording,
      caveat: row.publicCaveat,
      featured: Boolean(row.featured),
      sortOrder: Number(row.sortOrder) || 0,
      verificationState: row.verificationState,
      evidenceAccess: row.evidenceAccess,
      publicPayload,
    };
    const validation = validatePublicProjection(publicRecord, `record:${row.id}`);
    if (!validation.ok) {
      throw new EditorialError(
        validation.code,
        `Publication blocked: ${validation.message}`,
        409,
      );
    }
    return publicRecord;
  });

  const canonicalContentJson = JSON.stringify({
    schemaVersion: "1.1",
    baseContentVersion: CURRENT_CONTENT_VERSION,
    records: projection,
  });
  const contentHash = await sha256(canonicalContentJson);
  const snapshotJson = JSON.stringify({
    schemaVersion: "1.1",
    baseContentVersion: CURRENT_CONTENT_VERSION,
    publishedAt,
    contentHash,
    records: projection,
  });
  const id = `publication:${publishedAt}:${crypto.randomUUID().slice(0, 8)}`;
  const settingJson = JSON.stringify({
    snapshotId: id,
    contentHash,
    contentVersion: CURRENT_CONTENT_VERSION,
    publishedAt,
  });

  await binding.batch([
    binding
      .prepare(
        `INSERT INTO publication_snapshots (
           id, content_hash, record_count, snapshot_json,
           published_by_email, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        contentHash,
        projection.length,
        snapshotJson,
        actorEmail,
        publishedAt,
      ),
    binding
      .prepare(
        `UPDATE public_records
         SET published_at = ?
         WHERE publication_state = 'public'`,
      )
      .bind(publishedAt),
    binding
      .prepare(
        `INSERT INTO editorial_settings (
           key, value_json, updated_by_email, updated_at
         ) VALUES ('publication.current', ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_by_email = excluded.updated_by_email,
           updated_at = excluded.updated_at`,
      )
      .bind(settingJson, actorEmail, publishedAt),
    binding
      .prepare(
        `INSERT INTO audit_log (
           id, actor_email, action, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, 'editorial.snapshot_published',
                   'publication_snapshot', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actorEmail,
        id,
        JSON.stringify({
          contentHash,
          contentVersion: CURRENT_CONTENT_VERSION,
          recordCount: projection.length,
        }),
        publishedAt,
      ),
  ]);

  return {
    id,
    contentHash,
    recordCount: projection.length,
    publishedAt,
  };
}
