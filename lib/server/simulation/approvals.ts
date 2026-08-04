import { runtimeDatabase } from "../runtime-env";
import {
  type PlayProvider,
  type SimulationProviderApproval,
} from "./contracts";

const PROVIDERS: readonly PlayProvider[] = [
  "myanimelist",
  "hardcover",
  "spotify",
  "discogs",
  "steam",
  "strava",
];
const SCOPES = ["game_display", "llm_context"] as const;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

type StoredApprovalRow = {
  provider: string;
  scopesJson: string;
  reference: string;
  approvedAt: string;
  expiresAt: string | null;
  enabled: number | boolean;
};

function canonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function validateSimulationProviderApproval(
  value: unknown,
): SimulationProviderApproval | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const approval = value as Record<string, unknown>;
  const keys = new Set([
    "provider",
    "scopes",
    "reference",
    "approvedAt",
    "expiresAt",
    "enabled",
  ]);
  if (
    Object.keys(approval).length !== keys.size ||
    Object.keys(approval).some((key) => !keys.has(key)) ||
    !PROVIDERS.includes(approval.provider as PlayProvider) ||
    !Array.isArray(approval.scopes) ||
    approval.scopes.length < 1 ||
    approval.scopes.length > SCOPES.length ||
    !approval.scopes.every((scope) =>
      SCOPES.includes(scope as (typeof SCOPES)[number]),
    ) ||
    new Set(approval.scopes).size !== approval.scopes.length ||
    typeof approval.reference !== "string" ||
    approval.reference.length < 1 ||
    approval.reference.length > 512 ||
    CONTROL_CHARACTER.test(approval.reference) ||
    typeof approval.approvedAt !== "string" ||
    !canonicalTimestamp(approval.approvedAt) ||
    !(
      approval.expiresAt === null ||
      (typeof approval.expiresAt === "string" &&
        canonicalTimestamp(approval.expiresAt))
    ) ||
    typeof approval.enabled !== "boolean"
  ) {
    return null;
  }
  if (
    typeof approval.expiresAt === "string" &&
    Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt)
  ) {
    return null;
  }
  return {
    provider: approval.provider as PlayProvider,
    scopes: [...approval.scopes] as SimulationProviderApproval["scopes"],
    reference: approval.reference.trim(),
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt as string | null,
    enabled: approval.enabled,
  };
}

function parseStoredApproval(row: StoredApprovalRow): SimulationProviderApproval | null {
  let scopes: unknown;
  try {
    scopes = JSON.parse(row.scopesJson);
  } catch {
    return null;
  }
  return validateSimulationProviderApproval({
    provider: row.provider,
    scopes,
    reference: row.reference,
    approvedAt: row.approvedAt,
    expiresAt: row.expiresAt,
    enabled: Boolean(row.enabled),
  });
}

function databaseOrThrow(database?: D1Database | null): D1Database {
  const candidate = database ?? runtimeDatabase();
  if (!candidate) throw new Error("simulation_database_unavailable");
  return candidate;
}

export async function listSimulationProviderApprovals(
  database?: D1Database | null,
): Promise<SimulationProviderApproval[]> {
  const result = await databaseOrThrow(database)
    .prepare(
      `SELECT provider, scopes_json AS scopesJson, reference,
              approved_at AS approvedAt, expires_at AS expiresAt, enabled
       FROM simulation_provider_approvals
       ORDER BY provider ASC`,
    )
    .all<StoredApprovalRow>();
  return (result.results ?? []).flatMap((row) => {
    const approval = parseStoredApproval(row);
    return approval ? [approval] : [];
  });
}

export async function upsertSimulationProviderApproval(
  approval: SimulationProviderApproval,
  database?: D1Database | null,
): Promise<void> {
  const validated = validateSimulationProviderApproval(approval);
  if (!validated) throw new Error("simulation_approval_invalid");
  await databaseOrThrow(database)
    .prepare(
      `INSERT INTO simulation_provider_approvals (
         provider, scopes_json, reference, approved_at, expires_at, enabled,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         scopes_json = excluded.scopes_json,
         reference = excluded.reference,
         approved_at = excluded.approved_at,
         expires_at = excluded.expires_at,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
    .bind(
      validated.provider,
      JSON.stringify(validated.scopes),
      validated.reference,
      validated.approvedAt,
      validated.expiresAt,
      validated.enabled ? 1 : 0,
      new Date().toISOString(),
    )
    .run();
}

export async function disableSimulationProviderApproval(
  provider: PlayProvider,
  database?: D1Database | null,
): Promise<void> {
  if (!PROVIDERS.includes(provider)) {
    throw new Error("simulation_provider_invalid");
  }
  await databaseOrThrow(database)
    .prepare(
      `UPDATE simulation_provider_approvals
       SET enabled = 0, updated_at = ?
       WHERE provider = ?`,
    )
    .bind(new Date().toISOString(), provider)
    .run();
}

export async function providerApprovedForSimulationModel(
  provider: PlayProvider,
  now = new Date(),
  database?: D1Database | null,
): Promise<boolean> {
  const row = await databaseOrThrow(database)
    .prepare(
      `SELECT provider, scopes_json AS scopesJson, reference,
              approved_at AS approvedAt, expires_at AS expiresAt, enabled
       FROM simulation_provider_approvals
       WHERE provider = ?
       LIMIT 1`,
    )
    .bind(provider)
    .first<StoredApprovalRow>();
  if (!row) return false;
  const approval = parseStoredApproval(row);
  return Boolean(
    approval?.enabled &&
      approval.scopes.includes("game_display") &&
      approval.scopes.includes("llm_context") &&
      (!approval.expiresAt || Date.parse(approval.expiresAt) > now.getTime()),
  );
}
