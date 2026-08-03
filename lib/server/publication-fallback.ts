export const PUBLICATION_FALLBACK_KEY = "publication:current:v1";
const PUBLICATION_VERSION_PREFIX = "publication:version:v1:";

export type PublicationSnapshotRow = {
  snapshotJson: string;
  contentHash: string;
};

type PublicationFallbackEnvelope = PublicationSnapshotRow & {
  schemaVersion: "1.0";
  replicatedAt: string;
};

type PublicationFallbackPointer = {
  schemaVersion: "1.0";
  versionKey: string;
  contentHash: string;
  activatedAt: string;
};

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function publicationVersionKey(
  contentHash: string,
  publishedAt: string,
): string {
  if (!validHash(contentHash) || !Number.isFinite(Date.parse(publishedAt))) {
    throw new Error("A publication version key requires a valid hash and timestamp.");
  }
  return `${PUBLICATION_VERSION_PREFIX}${contentHash.toLowerCase()}:${Date.parse(publishedAt)}`;
}

export function publicationFallbackPointer(
  versionKey: string,
  contentHash: string,
  activatedAt = new Date().toISOString(),
): PublicationFallbackPointer {
  if (
    !versionKey.startsWith(PUBLICATION_VERSION_PREFIX) ||
    versionKey.length > 180 ||
    !validHash(contentHash) ||
    !Number.isFinite(Date.parse(activatedAt))
  ) {
    throw new Error("The publication fallback pointer is invalid.");
  }
  return {
    schemaVersion: "1.0",
    versionKey,
    contentHash: contentHash.toLowerCase(),
    activatedAt,
  };
}

export function parsePublicationFallbackPointer(
  value: string | null,
): PublicationFallbackPointer | null {
  if (!value || value.length > 2_048) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      Object.keys(parsed).length !== 4 ||
      parsed.schemaVersion !== "1.0" ||
      typeof parsed.versionKey !== "string" ||
      !/^publication:version:v1:[a-f0-9]{64}:\d{13}$/i.test(parsed.versionKey) ||
      !validHash(parsed.contentHash) ||
      !parsed.versionKey.includes(parsed.contentHash.toLowerCase()) ||
      typeof parsed.activatedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.activatedAt))
    ) {
      return null;
    }
    return parsed as PublicationFallbackPointer;
  } catch {
    return null;
  }
}

export function parsePublicationFallbackEnvelope(
  value: string | null,
): PublicationSnapshotRow | null {
  if (!value || value.length > 16 * 1024 * 1024) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      Object.keys(parsed).length !== 4 ||
      parsed.schemaVersion !== "1.0" ||
      typeof parsed.snapshotJson !== "string" ||
      typeof parsed.contentHash !== "string" ||
      !validHash(parsed.contentHash) ||
      typeof parsed.replicatedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.replicatedAt))
    ) {
      return null;
    }
    return {
      snapshotJson: parsed.snapshotJson,
      contentHash: parsed.contentHash,
    };
  } catch {
    return null;
  }
}

export function publicationFallbackEnvelope(
  row: PublicationSnapshotRow,
  replicatedAt = new Date().toISOString(),
): PublicationFallbackEnvelope {
  return {
    schemaVersion: "1.0",
    snapshotJson: row.snapshotJson,
    contentHash: row.contentHash,
    replicatedAt,
  };
}

export async function readPublicationFallback(
  store: KVNamespace,
): Promise<PublicationSnapshotRow | null> {
  const pointer = parsePublicationFallbackPointer(
    await store.get(PUBLICATION_FALLBACK_KEY, "text"),
  );
  if (!pointer) return null;
  const row = parsePublicationFallbackEnvelope(
    await store.get(pointer.versionKey, "text"),
  );
  return row && row.contentHash.toLowerCase() === pointer.contentHash.toLowerCase()
    ? row
    : null;
}
