import publicBundleJson from "../../content/public/anish-content.public.v1.json" with {
  type: "json",
};
import type { AnishContentBundle } from "../../types/content";
import { resolveVerifiedPublicContentFromSnapshotRow } from "./public-content-selector";
import {
  parsePublicationFallbackEnvelope,
  parsePublicationFallbackPointer,
  PUBLICATION_FALLBACK_KEY,
} from "./publication-fallback";

type CheckpointRow = {
  contentHash: string;
  recordCount: number;
  snapshotJson: string;
  publishedAt: string;
  settingContentHash: string;
  settingContentVersion: string;
};

export type PublicationCheckpoint = {
  status: "ready" | "unavailable" | "drifted";
  contentHash: string | null;
  contentVersion: string | null;
  recordCount: number | null;
  publishedAt: string | null;
  kvPointerMatches: boolean;
};

const staticPublicBundle = publicBundleJson as AnishContentBundle;

function unavailable(status: "unavailable" | "drifted"): PublicationCheckpoint {
  return {
    status,
    contentHash: null,
    contentVersion: null,
    recordCount: null,
    publishedAt: null,
    kvPointerMatches: false,
  };
}

function canonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

export async function getPublicationCheckpointFromStores(
  database: D1Database | null,
  fallbackStore: KVNamespace | null,
): Promise<PublicationCheckpoint> {
  if (!database || !fallbackStore) return unavailable("unavailable");

  let row: CheckpointRow | null;
  try {
    row = await database
      .prepare(
        `SELECT snapshots.content_hash AS contentHash,
                snapshots.record_count AS recordCount,
                snapshots.snapshot_json AS snapshotJson,
                snapshots.created_at AS publishedAt,
                json_extract(settings.value_json, '$.contentHash') AS settingContentHash,
                json_extract(settings.value_json, '$.contentVersion') AS settingContentVersion
         FROM editorial_settings AS settings
         JOIN publication_snapshots AS snapshots
           ON snapshots.id = json_extract(settings.value_json, '$.snapshotId')
         WHERE settings.key = 'publication.current'
         LIMIT 1`,
      )
      .first<CheckpointRow>();
  } catch {
    return unavailable("unavailable");
  }
  if (!row) return unavailable("unavailable");

  let parsedSnapshot: Record<string, unknown>;
  try {
    parsedSnapshot = JSON.parse(row.snapshotJson) as Record<string, unknown>;
  } catch {
    return unavailable("drifted");
  }
  const contentVersion = parsedSnapshot.baseContentVersion;
  const publishedAt = parsedSnapshot.publishedAt;
  const records = parsedSnapshot.records;
  const d1Verified = await resolveVerifiedPublicContentFromSnapshotRow(
    staticPublicBundle,
    { snapshotJson: row.snapshotJson, contentHash: row.contentHash },
  );
  if (
    !d1Verified ||
    typeof contentVersion !== "string" ||
    !/^[a-f0-9]{16}$/.test(contentVersion) ||
    typeof publishedAt !== "string" ||
    !canonicalTimestamp(publishedAt) ||
    !Array.isArray(records) ||
    row.recordCount !== records.length ||
    row.publishedAt !== publishedAt ||
    row.settingContentHash !== row.contentHash ||
    row.settingContentVersion !== contentVersion
  ) {
    return unavailable("drifted");
  }

  let kvPointerMatches = false;
  try {
    const pointer = parsePublicationFallbackPointer(
      await fallbackStore.get(PUBLICATION_FALLBACK_KEY, "text"),
    );
    if (pointer && pointer.contentHash === row.contentHash.toLowerCase()) {
      const envelope = parsePublicationFallbackEnvelope(
        await fallbackStore.get(pointer.versionKey, "text"),
      );
      kvPointerMatches = Boolean(
        envelope &&
          envelope.contentHash.toLowerCase() === row.contentHash.toLowerCase() &&
          envelope.snapshotJson === row.snapshotJson,
      );
    }
  } catch {
    kvPointerMatches = false;
  }

  return {
    status: kvPointerMatches ? "ready" : "drifted",
    contentHash: row.contentHash.toLowerCase(),
    contentVersion,
    recordCount: row.recordCount,
    publishedAt,
    kvPointerMatches,
  };
}
