import { runtimeDatabase } from "../runtime-env";
import { connectorPublicationGate } from "./publication-approval";
import { parseStoredConnectorPublicPayload } from "./public-payload-policy";

export {
  DISCOGS_EXTENDED_DISPLAY_APPROVAL_SETTING_KEY,
  discogsExtendedDisplayApprovalIsActive,
  getDiscogsExtendedDisplayApproval,
  type DiscogsExtendedDisplayApproval,
} from "./discogs-extended-display-approval";

export const DISCOGS_PRESENTATION_SETTING_KEY =
  "connector.discogs.presentation";

export type DiscogsPresentationConfig = {
  publishCollection: boolean;
  reviewedAt: string | null;
  updatedAt: string | null;
};

const CONFIG_VERSION = 1;

type StoredDiscogsPresentationConfig = DiscogsPresentationConfig & {
  credentialGeneration: number | null;
};

function emptyConfig(): DiscogsPresentationConfig {
  return {
    publishCollection: false,
    reviewedAt: null,
    updatedAt: null,
  };
}

function canonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function parseStoredConfig(
  valueJson: string,
  updatedAt: string,
): StoredDiscogsPresentationConfig | null {
  let value: unknown;
  try {
    value = JSON.parse(valueJson) as unknown;
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 4 ||
    !keys.every((key) =>
      [
        "schemaVersion",
        "publishCollection",
        "reviewedAt",
        "credentialGeneration",
      ].includes(key),
    ) ||
    record.schemaVersion !== CONFIG_VERSION ||
    typeof record.publishCollection !== "boolean" ||
    !canonicalIsoTimestamp(updatedAt) ||
    !(
      record.reviewedAt === null ||
      canonicalIsoTimestamp(record.reviewedAt)
    ) ||
    (record.publishCollection && record.reviewedAt === null) ||
    (!record.publishCollection && record.reviewedAt !== null) ||
    (record.publishCollection &&
      (!Number.isSafeInteger(record.credentialGeneration) ||
        Number(record.credentialGeneration) < 1)) ||
    (!record.publishCollection && record.credentialGeneration !== null)
  ) {
    return null;
  }
  return {
    publishCollection: record.publishCollection,
    reviewedAt: record.reviewedAt as string | null,
    credentialGeneration: record.credentialGeneration as number | null,
    updatedAt,
  };
}

async function currentCredentialGeneration(
  database: D1Database,
): Promise<number | null> {
  const row = await database
    .prepare(
      `SELECT generation
       FROM connector_credentials
       WHERE provider = 'discogs'
       LIMIT 1`,
    )
    .first<{ generation: number }>();
  const generation = Number(row?.generation);
  return Number.isSafeInteger(generation) && generation > 0
    ? generation
    : null;
}

async function hasCurrentValidatedSnapshot(
  database: D1Database,
  now: number,
  allowStale: boolean,
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT status, public_payload_json AS publicPayloadJson,
              fetched_at AS fetchedAt, fresh_until AS freshUntil
       FROM connector_snapshots
       WHERE provider = 'discogs' AND status = 'ready'
       ORDER BY fetched_at DESC, id DESC
       LIMIT 1`,
    )
    .first<{
      status: string;
      publicPayloadJson: string;
      fetchedAt: string;
      freshUntil: string;
    }>();
  if (
    !row ||
    row.status !== "ready" ||
    !canonicalIsoTimestamp(row.fetchedAt) ||
    !canonicalIsoTimestamp(row.freshUntil) ||
    (!allowStale && Date.parse(row.freshUntil) <= now)
  ) {
    return false;
  }
  const payload = parseStoredConnectorPublicPayload(
    "discogs",
    row.publicPayloadJson,
  );
  return Boolean(
    payload &&
      payload.syncedAt === row.fetchedAt &&
      payload.freshUntil === row.freshUntil,
  );
}

export async function getDiscogsPresentationConfig(
  database: D1Database | null = runtimeDatabase(),
): Promise<
  | { status: "ready"; config: DiscogsPresentationConfig }
  | { status: "setup_required" }
> {
  if (!database) return { status: "setup_required" };
  try {
    const row = await database
      .prepare(
        `SELECT value_json AS valueJson, updated_at AS updatedAt
         FROM editorial_settings
         WHERE key = ?
         LIMIT 1`,
      )
      .bind(DISCOGS_PRESENTATION_SETTING_KEY)
      .first<{ valueJson: string; updatedAt: string }>();
    if (!row) return { status: "ready", config: emptyConfig() };
    const config = parseStoredConfig(row.valueJson, row.updatedAt);
    if (!config) return { status: "setup_required" };
    if (config.publishCollection) {
      const generation = await currentCredentialGeneration(database);
      if (generation !== config.credentialGeneration) {
        return {
          status: "ready",
          config: { ...emptyConfig(), updatedAt: config.updatedAt },
        };
      }
    }
    return {
      status: "ready",
      config: {
        publishCollection: config.publishCollection,
        reviewedAt: config.reviewedAt,
        updatedAt: config.updatedAt,
      },
    };
  } catch {
    return { status: "setup_required" };
  }
}

export async function saveDiscogsPresentationConfig(input: {
  publishCollection: boolean;
  acknowledgeNoncommercial?: boolean;
  actorEmail: string;
}): Promise<
  | { status: "saved"; config: DiscogsPresentationConfig }
  | { status: "invalid"; reason: "acknowledgement" | "snapshot" }
  | { status: "setup_required" }
> {
  if (
    input.publishCollection &&
    input.acknowledgeNoncommercial !== true
  ) {
    return { status: "invalid", reason: "acknowledgement" };
  }
  const database = runtimeDatabase();
  if (!database) return { status: "setup_required" };

  const now = new Date().toISOString();
  const reviewedAt = input.publishCollection ? now : null;
  let credentialGeneration: number | null = null;
  if (input.publishCollection) {
    try {
      const publicationGate = await connectorPublicationGate(
        "discogs",
        database,
        Date.parse(now),
      );
      const allowStale =
        publicationGate.status === "allowed" &&
        publicationGate.retainLastKnownGood;
      credentialGeneration = await currentCredentialGeneration(database);
      if (
        credentialGeneration === null ||
        !(await hasCurrentValidatedSnapshot(
          database,
          Date.parse(now),
          allowStale,
        ))
      ) {
        return { status: "invalid", reason: "snapshot" };
      }
    } catch {
      return { status: "setup_required" };
    }
  }
  const stored = {
    schemaVersion: CONFIG_VERSION,
    publishCollection: input.publishCollection,
    reviewedAt,
    credentialGeneration,
  };
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO editorial_settings (
             key, value_json, updated_by_email, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_by_email = excluded.updated_by_email,
             updated_at = excluded.updated_at`,
        )
        .bind(
          DISCOGS_PRESENTATION_SETTING_KEY,
          JSON.stringify(stored),
          input.actorEmail,
          now,
        ),
      database
        .prepare(
          `INSERT INTO audit_log (
             id, actor_email, action, entity_type, entity_id,
             details_json, created_at
           ) VALUES (?, ?, 'connector.presentation_saved', 'connector',
                     'discogs', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.actorEmail,
          JSON.stringify({ publishCollection: input.publishCollection }),
          now,
        ),
    ]);
  } catch {
    return { status: "setup_required" };
  }
  return {
    status: "saved",
    config: {
      publishCollection: input.publishCollection,
      reviewedAt,
      updatedAt: now,
    },
  };
}

export async function deleteDiscogsPresentationConfig(
  database: D1Database,
): Promise<void> {
  await database
    .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
    .bind(DISCOGS_PRESENTATION_SETTING_KEY)
    .run();
}
