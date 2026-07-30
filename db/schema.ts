import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) =>
  text(name).notNull().default(sql`CURRENT_TIMESTAMP`);

/**
 * This table contains the deploy-safe projection only. Exact internal metrics,
 * private evidence, and raw source notes must never be inserted here.
 */
export const publicRecords = sqliteTable(
  "public_records",
  {
    id: text("id").primaryKey(),
    recordType: text("record_type").notNull(),
    slug: text("slug"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    approvedPublicWording: text("approved_public_wording").notNull().default(""),
    publicCaveat: text("public_caveat").notNull().default(""),
    publicPayloadJson: text("public_payload_json").notNull().default("{}"),
    publicationState: text("publication_state").notNull().default("review_required"),
    verificationState: text("verification_state").notNull().default("tentative"),
    evidenceAccess: text("evidence_access").notNull().default("public_web"),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedAt: text("published_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("public_records_slug_unique").on(table.slug),
    index("public_records_state_sort_idx").on(
      table.publicationState,
      table.sortOrder,
    ),
    index("public_records_type_idx").on(table.recordType),
  ],
);

export const editorialSettings = sqliteTable("editorial_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull().default("{}"),
  updatedByEmail: text("updated_by_email"),
  updatedAt: timestamp("updated_at"),
});

export const publicationSnapshots = sqliteTable(
  "publication_snapshots",
  {
    id: text("id").primaryKey(),
    contentHash: text("content_hash").notNull(),
    recordCount: integer("record_count").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    publishedByEmail: text("published_by_email").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("publication_snapshots_created_idx").on(table.createdAt),
    index("publication_snapshots_hash_idx").on(table.contentHash),
  ],
);

/**
 * The encrypted payload contains provider tokens. Only non-secret metadata is
 * stored alongside it so Studio can report configuration health without ever
 * decrypting credentials for display.
 */
export const connectorCredentials = sqliteTable("connector_credentials", {
  provider: text("provider").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  keyVersion: text("key_version").notNull().default("v1"),
  credentialLabel: text("credential_label").notNull().default("Owner credential"),
  scopesJson: text("scopes_json").notNull().default("[]"),
  expiresAt: text("expires_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const connectorSnapshots = sqliteTable(
  "connector_snapshots",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("ready"),
    publicPayloadJson: text("public_payload_json").notNull(),
    fetchedAt: timestamp("fetched_at"),
    freshUntil: text("fresh_until").notNull(),
    etag: text("etag"),
    itemCount: integer("item_count").notNull().default(0),
  },
  (table) => [
    index("connector_snapshots_provider_fetched_idx").on(
      table.provider,
      table.fetchedAt,
    ),
  ],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    requestedByEmail: text("requested_by_email"),
    startedAt: timestamp("started_at"),
    finishedAt: text("finished_at"),
    httpStatus: integer("http_status"),
    itemCount: integer("item_count"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("sync_runs_provider_started_idx").on(table.provider, table.startedAt),
    uniqueIndex("sync_runs_one_running_per_provider")
      .on(table.provider)
      .where(sql`${table.status} = 'running'`),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: timestamp("created_at"),
  },
  (table) => [index("audit_log_created_idx").on(table.createdAt)],
);
