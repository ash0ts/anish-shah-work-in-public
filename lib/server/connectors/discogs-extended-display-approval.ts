import { runtimeDatabase } from "../runtime-env";

export const DISCOGS_EXTENDED_DISPLAY_APPROVAL_SETTING_KEY =
  "connector.discogs.extended_display_approval";

export type DiscogsExtendedDisplayApproval = {
  provider: "discogs";
  reference: string;
  approvedAt: string;
  expiresAt: string | null;
  enabled: boolean;
  updatedAt: string;
};

const APPROVAL_VERSION = 1;
const MAX_APPROVAL_REFERENCE_LENGTH = 512;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function canonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function parseStoredApproval(
  valueJson: string,
  updatedAt: string,
): DiscogsExtendedDisplayApproval | null {
  let value: unknown;
  try {
    value = JSON.parse(valueJson) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 6 ||
    !keys.every((key) =>
      [
        "schemaVersion",
        "provider",
        "reference",
        "approvedAt",
        "expiresAt",
        "enabled",
      ].includes(key),
    ) ||
    record.schemaVersion !== APPROVAL_VERSION ||
    record.provider !== "discogs" ||
    typeof record.reference !== "string" ||
    record.reference.trim() !== record.reference ||
    record.reference.length < 1 ||
    record.reference.length > MAX_APPROVAL_REFERENCE_LENGTH ||
    CONTROL_CHARACTER.test(record.reference) ||
    !canonicalIsoTimestamp(record.approvedAt) ||
    !(
      record.expiresAt === null || canonicalIsoTimestamp(record.expiresAt)
    ) ||
    (typeof record.expiresAt === "string" &&
      Date.parse(record.expiresAt) <= Date.parse(record.approvedAt)) ||
    typeof record.enabled !== "boolean" ||
    !canonicalIsoTimestamp(updatedAt)
  ) {
    return null;
  }
  return {
    provider: "discogs",
    reference: record.reference,
    approvedAt: record.approvedAt,
    expiresAt: record.expiresAt as string | null,
    enabled: record.enabled,
    updatedAt,
  };
}

export function discogsExtendedDisplayApprovalIsActive(
  approval: DiscogsExtendedDisplayApproval | null,
  now = Date.now(),
): boolean {
  if (!approval?.enabled) return false;
  const approvedAt = Date.parse(approval.approvedAt);
  if (!Number.isFinite(approvedAt) || approvedAt > now) return false;
  if (approval.expiresAt === null) return true;
  const expiresAt = Date.parse(approval.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export async function getDiscogsExtendedDisplayApproval(
  database: D1Database | null = runtimeDatabase(),
): Promise<
  | { status: "ready"; approval: DiscogsExtendedDisplayApproval | null }
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
      .bind(DISCOGS_EXTENDED_DISPLAY_APPROVAL_SETTING_KEY)
      .first<{ valueJson: string; updatedAt: string }>();
    if (!row) return { status: "ready", approval: null };
    const approval = parseStoredApproval(row.valueJson, row.updatedAt);
    return approval
      ? { status: "ready", approval }
      : { status: "setup_required" };
  } catch {
    return { status: "setup_required" };
  }
}
