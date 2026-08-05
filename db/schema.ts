import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
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
  generation: integer("generation").notNull().default(1),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

/**
 * OAuth state is stored only as a SHA-256 hash. The encrypted payload contains
 * the PKCE verifier, OAuth client secret, and—during an authentication resume—
 * the short-lived authorization code. Transactions are owner-bound,
 * single-use, and expire after ten minutes.
 */
export const connectorOauthTransactions = sqliteTable(
  "connector_oauth_transactions",
  {
    stateHash: text("state_hash").primaryKey(),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    keyVersion: text("key_version").notNull().default("v1"),
    ownerEmail: text("owner_email").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("connector_oauth_owner_provider_expiry_idx").on(
      table.ownerEmail,
      table.provider,
      table.expiresAt,
    ),
  ],
);

/**
 * Short-lived, owner-approved handoff from the isolated local Studio to the
 * production Studio. The bearer secret is stored only as a hash. Provider
 * credentials enter this table only after they have been encrypted with the
 * destination environment's connector key, and are deleted after review.
 */
export const playPromotionTransactions = sqliteTable(
  "play_promotion_transactions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    ownerEmail: text("owner_email").notNull(),
    targetOrigin: text("target_origin").notNull(),
    status: text("status").notNull().default("issued"),
    attempts: integer("attempts").notNull().default(0),
    ciphertext: text("ciphertext"),
    iv: text("iv"),
    keyVersion: text("key_version"),
    providersJson: text("providers_json").notNull().default("[]"),
    expiresAt: text("expires_at").notNull(),
    stagedExpiresAt: text("staged_expires_at"),
    consumedAt: text("consumed_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("play_promotion_transactions_token_hash_unique").on(
      table.tokenHash,
    ),
    index("play_promotion_owner_status_idx").on(
      table.ownerEmail,
      table.status,
      table.createdAt,
    ),
    index("play_promotion_expiry_idx").on(table.expiresAt),
  ],
);

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

/** Operational metadata only; never credentials, identities, or raw payloads. */
export const maintenanceState = sqliteTable("maintenance_state", {
  key: text("key").primaryKey(),
  status: text("status").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  checkedAt: text("checked_at").notNull(),
  updatedAt: timestamp("updated_at"),
});

/**
 * Short-lived game state only. The JSON column contains allowlisted campaign
 * IDs, enum signals, score counters, and one exact-validated response projection
 * used only for idempotent retry. Visitor prose, model prompts, and raw provider
 * responses must never be written here.
 */
export const simulationSessions = sqliteTable(
  "simulation_sessions",
  {
    sessionHash: text("session_hash").primaryKey(),
    campaignVersion: text("campaign_version").notNull(),
    status: text("status").notNull().default("active"),
    revision: integer("revision").notNull().default(0),
    sceneId: text("scene_id").notNull().default("act-1"),
    safeStateJson: text("safe_state_json").notNull(),
    freeTextTurns: integer("free_text_turns").notNull().default(0),
    generationCalls: integer("generation_calls").notNull().default(0),
    turnCount: integer("turn_count").notNull().default(0),
    pendingRequestId: text("pending_request_id"),
    generationLeaseUntil: text("generation_lease_until"),
    lastRequestId: text("last_request_id"),
    lastResponseJson: text("last_response_json"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("simulation_sessions_expiry_idx").on(table.expiresAt),
    index("simulation_sessions_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

/** Aggregate counters only; no visitor or prompt content. */
export const simulationDailyBudget = sqliteTable("simulation_daily_budget", {
  budgetDate: text("budget_date").primaryKey(),
  modelCalls: integer("model_calls").notNull().default(0),
  authoredFallbacks: integer("authored_fallbacks").notNull().default(0),
  updatedAt: timestamp("updated_at"),
});

/** Owner-only evidence that a provider may be used by the simulation. */
export const simulationProviderApprovals = sqliteTable(
  "simulation_provider_approvals",
  {
    provider: text("provider").primaryKey(),
    scopesJson: text("scopes_json").notNull().default("[]"),
    reference: text("reference").notNull(),
    approvedAt: text("approved_at").notNull(),
    expiresAt: text("expires_at"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("simulation_provider_approvals_enabled_expiry_idx").on(
      table.enabled,
      table.expiresAt,
    ),
  ],
);
export const travelTrips = sqliteTable(
  "travel_trips",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    status: text("status").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end"),
    periodPrecision: text("period_precision").notNull(),
    publishedAt: text("published_at"),
    revision: text("revision").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("travel_trips_slug_unique").on(table.slug),
    index("travel_trips_published_period_idx").on(
      table.publishedAt,
      table.periodStart,
    ),
    check(
      "travel_trips_status_check",
      sql`${table.status} IN ('planned', 'current', 'completed')`,
    ),
    check(
      "travel_trips_period_precision_check",
      sql`${table.periodPrecision} IN ('year', 'month', 'day')`,
    ),
  ],
);

export const travelPlaces = sqliteTable(
  "travel_places",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => travelTrips.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    countryCode: text("country_code").notNull(),
    countryName: text("country_name").notNull(),
    admin1Code: text("admin1_code"),
    admin1Name: text("admin1_name"),
    precision: text("precision").notNull(),
    publicLat: real("public_lat").notNull(),
    publicLng: real("public_lng").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    revision: text("revision").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("travel_places_trip_sort_idx").on(table.tripId, table.sortOrder),
    index("travel_places_country_admin_idx").on(
      table.countryCode,
      table.admin1Code,
    ),
    check(
      "travel_places_precision_check",
      sql`${table.precision} IN ('country', 'region', 'city_approximate')`,
    ),
  ],
);

export const travelPhotos = sqliteTable(
  "travel_photos",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => travelTrips.id, { onDelete: "cascade" }),
    placeId: text("place_id").references(() => travelPlaces.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull(),
    altText: text("alt_text").notNull(),
    caption: text("caption"),
    capturedAt: text("captured_at"),
    capturePrecision: text("capture_precision"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isCover: integer("is_cover", { mode: "boolean" }).notNull().default(false),
    revision: text("revision").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("travel_photos_storage_key_unique").on(table.storageKey),
    index("travel_photos_trip_sort_idx").on(table.tripId, table.sortOrder),
    index("travel_photos_place_idx").on(table.placeId),
    check(
      "travel_photos_capture_precision_check",
      sql`${table.capturePrecision} IS NULL OR ${table.capturePrecision} IN ('year', 'month', 'day')`,
    ),
  ],
);

export const travelPhotoTags = sqliteTable(
  "travel_photo_tags",
  {
    photoId: text("photo_id")
      .notNull()
      .references(() => travelPhotos.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.photoId, table.tag] }),
    index("travel_photo_tags_tag_idx").on(table.tag),
  ],
);

export const travelUploads = sqliteTable(
  "travel_uploads",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => travelTrips.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("issued"),
    mediaType: text("media_type").notNull(),
    declaredBytes: integer("declared_bytes").notNull(),
    storedBytes: integer("stored_bytes"),
    processedWidth: integer("processed_width"),
    processedHeight: integer("processed_height"),
    storageKey: text("storage_key"),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("travel_uploads_trip_status_idx").on(table.tripId, table.status),
    index("travel_uploads_expiry_idx").on(table.expiresAt),
    check(
      "travel_uploads_status_check",
      sql`${table.status} IN ('issued', 'uploaded', 'consumed', 'failed')`,
    ),
  ],
);

export const travelMediaDeletions = sqliteTable(
  "travel_media_deletions",
  {
    id: text("id").primaryKey(),
    storageKeysJson: text("storage_keys_json").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    completedAt: text("completed_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("travel_media_deletions_status_idx").on(
      table.status,
      table.updatedAt,
    ),
    check(
      "travel_media_deletions_status_check",
      sql`${table.status} IN ('pending', 'complete')`,
    ),
  ],
);

export const travelPublicationSnapshots = sqliteTable(
  "travel_publication_snapshots",
  {
    id: text("id").primaryKey(),
    snapshotJson: text("snapshot_json").notNull(),
    contentHash: text("content_hash").notNull(),
    tripCount: integer("trip_count").notNull().default(0),
    photoCount: integer("photo_count").notNull().default(0),
    publishedByEmail: text("published_by_email").notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    uniqueIndex("travel_publication_hash_unique").on(table.contentHash),
    index("travel_publication_published_idx").on(table.publishedAt),
  ],
);

export const travelPublicationState = sqliteTable("travel_publication_state", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => travelPublicationSnapshots.id, { onDelete: "restrict" }),
  contentHash: text("content_hash").notNull(),
  updatedAt: timestamp("updated_at"),
});
