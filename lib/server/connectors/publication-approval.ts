import {
  decryptCredential,
  encryptCredential,
  type EncryptedCredential,
} from "../credential-crypto";
import { runtimeValue } from "../runtime-env";
import {
  discogsExtendedDisplayApprovalIsActive,
  getDiscogsExtendedDisplayApproval,
} from "./discogs-extended-display-approval";
import { databaseOrNull } from "./repository-primitives";

export const PUBLIC_CONNECTOR_PROVIDERS = [
  "myanimelist",
  "hardcover",
  "spotify",
  "discogs",
  "steam",
  "strava",
] as const;

export const CONNECTOR_PUBLICATION_APPROVAL_SCOPES = [
  "public_display",
  "retain_last_known_good",
] as const;

export type PublicConnectorProvider =
  (typeof PUBLIC_CONNECTOR_PROVIDERS)[number];
export type ConnectorPublicationApprovalScope =
  (typeof CONNECTOR_PUBLICATION_APPROVAL_SCOPES)[number];
export type ConnectorPublicationEnforcementMode =
  | "report_only"
  | "required";

export type ConnectorPublicationApprovalSummary = {
  provider: PublicConnectorProvider;
  scopes: ConnectorPublicationApprovalScope[];
  approvedAt: string;
  expiresAt: string | null;
  enabled: boolean;
  active: boolean;
  referenceStored: true;
  source: "unified" | "legacy_discogs";
  updatedAt: string;
};

export type ConnectorPublicationApprovalOverview = {
  status: "ready";
  enforcement: {
    mode: ConnectorPublicationEnforcementMode;
    activatedAt: string | null;
    updatedAt: string | null;
  };
  providers: Array<{
    provider: PublicConnectorProvider;
    configured: boolean;
    approval: ConnectorPublicationApprovalSummary | null;
    missingScopes: ConnectorPublicationApprovalScope[];
  }>;
  activationReady: boolean;
  approvalStateDigest: string;
};

export const CONNECTOR_PUBLICATION_ENFORCEMENT_SETTING_KEY =
  "connector.publication_approval.enforcement";
const APPROVAL_SETTING_PREFIX = "connector.publication_approval.provider.";
const APPROVAL_PENDING_SETTING_PREFIX =
  "connector.publication_approval.pending.";
const STRAVA_SETTING_KEY = "connector.strava.public_embed";
const APPROVAL_VERSION = 1;
const ENFORCEMENT_VERSION = 1;
const MAX_REFERENCE_LENGTH = 512;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

type StoredApproval = {
  schemaVersion: 1;
  provider: PublicConnectorProvider;
  scopes: ConnectorPublicationApprovalScope[];
  encryptedReference: EncryptedCredential;
  approvedAt: string;
  expiresAt: string | null;
  enabled: boolean;
};

type StoredEnforcement = {
  schemaVersion: 1;
  mode: ConnectorPublicationEnforcementMode;
  activatedAt: string | null;
};

type StoredPendingApproval = {
  schemaVersion: 1;
  provider: PublicConnectorProvider;
  configuredAt: string;
};

type EditorialSettingRow = {
  valueJson: string;
  updatedAt: string;
};

export function isPublicConnectorProvider(
  value: string,
): value is PublicConnectorProvider {
  return PUBLIC_CONNECTOR_PROVIDERS.includes(
    value as PublicConnectorProvider,
  );
}

export function connectorPublicationApprovalSettingKey(
  provider: PublicConnectorProvider,
): string {
  return `${APPROVAL_SETTING_PREFIX}${provider}`;
}

export function connectorPublicationApprovalPendingSettingKey(
  provider: PublicConnectorProvider,
): string {
  return `${APPROVAL_PENDING_SETTING_PREFIX}${provider}`;
}

export function connectorPublicationApprovalPendingValue(
  provider: PublicConnectorProvider,
  configuredAt: string,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    provider,
    configuredAt,
  } satisfies StoredPendingApproval);
}

function canonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function exactKeys(record: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(record);
  return (
    keys.length === allowed.length &&
    keys.every((key) => allowed.includes(key))
  );
}

function canonicalScopes(
  value: unknown,
): ConnectorPublicationApprovalScope[] | null {
  if (!Array.isArray(value) || value.length < 1) return null;
  const unique = new Set<ConnectorPublicationApprovalScope>();
  for (const scope of value) {
    if (
      typeof scope !== "string" ||
      !CONNECTOR_PUBLICATION_APPROVAL_SCOPES.includes(
        scope as ConnectorPublicationApprovalScope,
      ) ||
      unique.has(scope as ConnectorPublicationApprovalScope)
    ) {
      return null;
    }
    unique.add(scope as ConnectorPublicationApprovalScope);
  }
  return CONNECTOR_PUBLICATION_APPROVAL_SCOPES.filter((scope) =>
    unique.has(scope),
  );
}

function encryptedReference(value: unknown): EncryptedCredential | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, ["ciphertext", "iv", "keyVersion"]) ||
    typeof record.ciphertext !== "string" ||
    typeof record.iv !== "string" ||
    record.keyVersion !== "v1" ||
    record.ciphertext.length < 1 ||
    record.iv.length < 1
  ) {
    return null;
  }
  return {
    ciphertext: record.ciphertext,
    iv: record.iv,
    keyVersion: "v1",
  };
}

function parseStoredApproval(
  provider: PublicConnectorProvider,
  valueJson: string,
): StoredApproval | null {
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
  const scopes = canonicalScopes(record.scopes);
  const encrypted = encryptedReference(record.encryptedReference);
  if (
    !exactKeys(record, [
      "schemaVersion",
      "provider",
      "scopes",
      "encryptedReference",
      "approvedAt",
      "expiresAt",
      "enabled",
    ]) ||
    record.schemaVersion !== APPROVAL_VERSION ||
    record.provider !== provider ||
    !scopes ||
    !encrypted ||
    !canonicalIsoTimestamp(record.approvedAt) ||
    !(
      record.expiresAt === null ||
      canonicalIsoTimestamp(record.expiresAt)
    ) ||
    (typeof record.expiresAt === "string" &&
      Date.parse(record.expiresAt) <= Date.parse(record.approvedAt)) ||
    typeof record.enabled !== "boolean"
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    provider,
    scopes,
    encryptedReference: encrypted,
    approvedAt: record.approvedAt,
    expiresAt: record.expiresAt as string | null,
    enabled: record.enabled,
  };
}

function parseStoredEnforcement(
  row: EditorialSettingRow | null,
):
  | {
      mode: ConnectorPublicationEnforcementMode;
      activatedAt: string | null;
      updatedAt: string | null;
    }
  | null {
  if (!row) {
    return { mode: "report_only", activatedAt: null, updatedAt: null };
  }
  let value: unknown;
  try {
    value = JSON.parse(row.valueJson) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, ["schemaVersion", "mode", "activatedAt"]) ||
    record.schemaVersion !== ENFORCEMENT_VERSION ||
    (record.mode !== "report_only" && record.mode !== "required") ||
    !(
      record.activatedAt === null ||
      canonicalIsoTimestamp(record.activatedAt)
    ) ||
    !canonicalIsoTimestamp(row.updatedAt)
  ) {
    return null;
  }
  return {
    mode: record.mode,
    activatedAt: record.activatedAt as string | null,
    updatedAt: row.updatedAt,
  };
}

function parseStoredPendingApproval(
  provider: PublicConnectorProvider,
  valueJson: string,
): StoredPendingApproval | null {
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
  if (
    !exactKeys(record, ["schemaVersion", "provider", "configuredAt"]) ||
    record.schemaVersion !== 1 ||
    record.provider !== provider ||
    !canonicalIsoTimestamp(record.configuredAt)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    provider,
    configuredAt: record.configuredAt,
  };
}

function approvalIsActive(
  approval: Pick<
    ConnectorPublicationApprovalSummary,
    "enabled" | "approvedAt" | "expiresAt"
  >,
  now: number,
): boolean {
  if (!approval.enabled) return false;
  const approvedAt = Date.parse(approval.approvedAt);
  if (!Number.isFinite(approvedAt) || approvedAt > now) return false;
  if (approval.expiresAt === null) return true;
  const expiresAt = Date.parse(approval.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function requiredScopesMissing(
  approval: ConnectorPublicationApprovalSummary | null,
): ConnectorPublicationApprovalScope[] {
  if (!approval?.active || approval.source !== "unified") {
    return [...CONNECTOR_PUBLICATION_APPROVAL_SCOPES];
  }
  return CONNECTOR_PUBLICATION_APPROVAL_SCOPES.filter(
    (scope) => !approval.scopes.includes(scope),
  );
}

async function readSetting(
  database: D1Database,
  key: string,
): Promise<EditorialSettingRow | null> {
  return database
    .prepare(
      `SELECT value_json AS valueJson, updated_at AS updatedAt
       FROM editorial_settings
       WHERE key = ?
       LIMIT 1`,
    )
    .bind(key)
    .first<EditorialSettingRow>();
}

async function unifiedApproval(
  provider: PublicConnectorProvider,
  database: D1Database,
  now: number,
): Promise<ConnectorPublicationApprovalSummary | null | "invalid"> {
  const row = await readSetting(
    database,
    connectorPublicationApprovalSettingKey(provider),
  );
  if (!row) return null;
  const stored = parseStoredApproval(provider, row.valueJson);
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!stored || !encryptionKey || !canonicalIsoTimestamp(row.updatedAt)) {
    return "invalid";
  }
  try {
    const decrypted = await decryptCredential<unknown>(
      stored.encryptedReference,
      encryptionKey,
      `publication-approval:${provider}`,
    );
    if (
      typeof decrypted !== "object" ||
      decrypted === null ||
      Array.isArray(decrypted) ||
      !exactKeys(decrypted as Record<string, unknown>, ["reference"]) ||
      typeof (decrypted as Record<string, unknown>).reference !== "string" ||
      ((decrypted as Record<string, unknown>).reference as string).length < 1
    ) {
      return "invalid";
    }
  } catch {
    return "invalid";
  }
  const base = {
    provider,
    scopes: stored.scopes,
    approvedAt: stored.approvedAt,
    expiresAt: stored.expiresAt,
    enabled: stored.enabled,
    referenceStored: true as const,
    source: "unified" as const,
    updatedAt: row.updatedAt,
  };
  return {
    ...base,
    active: approvalIsActive(base, now),
  };
}

async function pendingApproval(
  provider: PublicConnectorProvider,
  database: D1Database,
): Promise<boolean | "invalid"> {
  const row = await readSetting(
    database,
    connectorPublicationApprovalPendingSettingKey(provider),
  );
  if (!row) return false;
  return parseStoredPendingApproval(provider, row.valueJson)
    ? true
    : "invalid";
}

async function legacyDiscogsApproval(
  database: D1Database,
  now: number,
): Promise<ConnectorPublicationApprovalSummary | null | "invalid"> {
  const result = await getDiscogsExtendedDisplayApproval(database);
  if (result.status !== "ready") return "invalid";
  if (!result.approval) return null;
  return {
    provider: "discogs",
    scopes: [...CONNECTOR_PUBLICATION_APPROVAL_SCOPES],
    approvedAt: result.approval.approvedAt,
    expiresAt: result.approval.expiresAt,
    enabled: result.approval.enabled,
    active: discogsExtendedDisplayApprovalIsActive(result.approval, now),
    referenceStored: true,
    source: "legacy_discogs",
    updatedAt: result.approval.updatedAt,
  };
}

export async function getConnectorPublicationEnforcement(
  database: D1Database | null = databaseOrNull(),
): Promise<
  | {
      status: "ready";
      enforcement: ConnectorPublicationApprovalOverview["enforcement"];
    }
  | { status: "setup_required" }
> {
  if (!database) return { status: "setup_required" };
  try {
    const parsed = parseStoredEnforcement(
      await readSetting(database, CONNECTOR_PUBLICATION_ENFORCEMENT_SETTING_KEY),
    );
    return parsed
      ? { status: "ready", enforcement: parsed }
      : { status: "setup_required" };
  } catch {
    return { status: "setup_required" };
  }
}

export async function getConnectorPublicationApproval(
  provider: PublicConnectorProvider,
  database: D1Database | null = databaseOrNull(),
  now = Date.now(),
): Promise<
  | {
      status: "ready";
      approval: ConnectorPublicationApprovalSummary | null;
    }
  | { status: "setup_required" }
> {
  if (!database) return { status: "setup_required" };
  try {
    const unified = await unifiedApproval(provider, database, now);
    if (unified === "invalid") return { status: "setup_required" };
    if (unified) return { status: "ready", approval: unified };
    if (provider === "discogs") {
      const legacy = await legacyDiscogsApproval(database, now);
      return legacy === "invalid"
        ? { status: "setup_required" }
        : { status: "ready", approval: legacy };
    }
    return { status: "ready", approval: null };
  } catch {
    return { status: "setup_required" };
  }
}

async function configuredProviders(
  database: D1Database,
): Promise<Set<PublicConnectorProvider>> {
  const configured = new Set<PublicConnectorProvider>();
  const credentials = await database
    .prepare(`SELECT provider FROM connector_credentials`)
    .all<{ provider: string }>();
  for (const row of credentials.results ?? []) {
    if (isPublicConnectorProvider(row.provider) && row.provider !== "strava") {
      configured.add(row.provider);
    }
  }
  const strava = await database
    .prepare(
      `SELECT key FROM editorial_settings WHERE key = ? LIMIT 1`,
    )
    .bind(STRAVA_SETTING_KEY)
    .first<{ key: string }>();
  if (strava) configured.add("strava");
  return configured;
}

async function digestOverview(
  enforcement: ConnectorPublicationApprovalOverview["enforcement"],
  providers: ConnectorPublicationApprovalOverview["providers"],
): Promise<string> {
  const serializable = {
    enforcement,
    providers: providers.map(({ provider, configured, approval, missingScopes }) => ({
      provider,
      configured,
      approval: approval
        ? {
            scopes: approval.scopes,
            approvedAt: approval.approvedAt,
            expiresAt: approval.expiresAt,
            enabled: approval.enabled,
            active: approval.active,
            source: approval.source,
            updatedAt: approval.updatedAt,
          }
        : null,
      missingScopes,
    })),
  };
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(serializable)),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getConnectorPublicationApprovalOverview(
  database: D1Database | null = databaseOrNull(),
  now = Date.now(),
): Promise<ConnectorPublicationApprovalOverview | { status: "setup_required" }> {
  if (!database) return { status: "setup_required" };
  const enforcementResult = await getConnectorPublicationEnforcement(database);
  if (enforcementResult.status !== "ready") return enforcementResult;
  try {
    const configured = await configuredProviders(database);
    const providers = await Promise.all(
      PUBLIC_CONNECTOR_PROVIDERS.map(async (provider) => {
        const result = await getConnectorPublicationApproval(
          provider,
          database,
          now,
        );
        if (result.status !== "ready") throw new Error("approval_invalid");
        return {
          provider,
          configured: configured.has(provider),
          approval: result.approval,
          missingScopes: requiredScopesMissing(result.approval),
        };
      }),
    );
    const activationReady = providers
      .filter((entry) => entry.configured)
      .every((entry) => entry.missingScopes.length === 0);
    return {
      status: "ready",
      enforcement: enforcementResult.enforcement,
      providers,
      activationReady,
      approvalStateDigest: await digestOverview(
        enforcementResult.enforcement,
        providers,
      ),
    };
  } catch {
    return { status: "setup_required" };
  }
}

export async function connectorPublicationGate(
  provider: PublicConnectorProvider,
  database: D1Database | null = databaseOrNull(),
  now = Date.now(),
): Promise<{
  status: "allowed" | "withheld" | "setup_required";
  mode: ConnectorPublicationEnforcementMode | null;
  retainLastKnownGood: boolean;
}> {
  const enforcement = await getConnectorPublicationEnforcement(database);
  if (enforcement.status !== "ready") {
    return { status: "setup_required", mode: null, retainLastKnownGood: false };
  }
  if (enforcement.enforcement.mode === "report_only") {
    const binding = database ?? databaseOrNull();
    if (!binding) {
      return {
        status: "setup_required",
        mode: "report_only",
        retainLastKnownGood: false,
      };
    }
    let pending: boolean | "invalid";
    try {
      pending = await pendingApproval(provider, binding);
    } catch {
      pending = "invalid";
    }
    if (pending === "invalid") {
      return {
        status: "setup_required",
        mode: "report_only",
        retainLastKnownGood: false,
      };
    }
    if (pending) {
      const approval = await getConnectorPublicationApproval(
        provider,
        binding,
        now,
      );
      if (
        approval.status !== "ready" ||
        requiredScopesMissing(approval.approval).length > 0
      ) {
        return {
          status: "withheld",
          mode: "report_only",
          retainLastKnownGood: false,
        };
      }
      return {
        status: "allowed",
        mode: "report_only",
        retainLastKnownGood: true,
      };
    }
    return {
      status: "allowed",
      mode: "report_only",
      retainLastKnownGood: true,
    };
  }
  const approval = await getConnectorPublicationApproval(
    provider,
    database,
    now,
  );
  if (approval.status !== "ready") {
    return {
      status: "setup_required",
      mode: "required",
      retainLastKnownGood: false,
    };
  }
  const missing = requiredScopesMissing(approval.approval);
  return missing.length === 0
    ? {
        status: "allowed",
        mode: "required",
        retainLastKnownGood: true,
      }
    : {
        status: "withheld",
        mode: "required",
        retainLastKnownGood: false,
      };
}

export async function saveConnectorPublicationApproval(input: {
  provider: PublicConnectorProvider;
  reference?: string;
  scopes: ConnectorPublicationApprovalScope[];
  approvedAt: string;
  expiresAt: string | null;
  enabled: boolean;
  actorEmail: string;
  database?: D1Database | null;
}): Promise<
  | { status: "saved"; approval: ConnectorPublicationApprovalSummary }
  | { status: "invalid"; reason: "approval" | "reference" }
  | { status: "setup_required" }
> {
  const database = input.database ?? databaseOrNull();
  const encryptionKey = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!database || !encryptionKey) return { status: "setup_required" };
  const scopes = canonicalScopes(input.scopes);
  if (
    !isPublicConnectorProvider(input.provider) ||
    !scopes ||
    !canonicalIsoTimestamp(input.approvedAt) ||
    !(input.expiresAt === null || canonicalIsoTimestamp(input.expiresAt)) ||
    (input.expiresAt !== null &&
      Date.parse(input.expiresAt) <= Date.parse(input.approvedAt)) ||
    typeof input.enabled !== "boolean"
  ) {
    return { status: "invalid", reason: "approval" };
  }

  let encrypted: EncryptedCredential | null = null;
  const reference = input.reference?.trim();
  if (input.reference !== undefined) {
    if (
      !reference ||
      reference !== input.reference ||
      reference.length > MAX_REFERENCE_LENGTH ||
      CONTROL_CHARACTER.test(reference)
    ) {
      return { status: "invalid", reason: "reference" };
    }
    try {
      encrypted = await encryptCredential(
        { reference },
        encryptionKey,
        `publication-approval:${input.provider}`,
      );
    } catch {
      return { status: "setup_required" };
    }
  } else {
    try {
      const existing = await readSetting(
        database,
        connectorPublicationApprovalSettingKey(input.provider),
      );
      const stored = existing
        ? parseStoredApproval(input.provider, existing.valueJson)
        : null;
      if (!stored) return { status: "invalid", reason: "reference" };
      encrypted = stored.encryptedReference;
    } catch {
      return { status: "setup_required" };
    }
  }

  const updatedAt = new Date().toISOString();
  const stored: StoredApproval = {
    schemaVersion: 1,
    provider: input.provider,
    scopes,
    encryptedReference: encrypted,
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt,
    enabled: input.enabled,
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
          connectorPublicationApprovalSettingKey(input.provider),
          JSON.stringify(stored),
          input.actorEmail,
          updatedAt,
        ),
      ...(input.provider === "discogs"
        ? [
            database
              .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
              .bind("connector.discogs.extended_display_approval"),
          ]
        : []),
      database
        .prepare(
          `INSERT INTO audit_log (
             id, actor_email, action, entity_type, entity_id,
             details_json, created_at
           ) VALUES (?, ?, 'connector.publication_approval_saved',
                     'connector', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.actorEmail,
          input.provider,
          JSON.stringify({
            scopes,
            enabled: input.enabled,
            hasExpiry: input.expiresAt !== null,
          }),
          updatedAt,
        ),
    ]);
  } catch {
    return { status: "setup_required" };
  }
  const base = {
    provider: input.provider,
    scopes,
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt,
    enabled: input.enabled,
    referenceStored: true as const,
    source: "unified" as const,
    updatedAt,
  };
  return {
    status: "saved",
    approval: { ...base, active: approvalIsActive(base, Date.now()) },
  };
}

export async function activateConnectorPublicationApprovals(input: {
  actorEmail: string;
  database?: D1Database | null;
}): Promise<
  | {
      status: "activated";
      enforcement: ConnectorPublicationApprovalOverview["enforcement"];
      approvalStateDigest: string;
    }
  | { status: "incomplete"; missingProviders: PublicConnectorProvider[] }
  | { status: "setup_required" }
> {
  const database = input.database ?? databaseOrNull();
  if (!database) return { status: "setup_required" };
  const activatedAt = new Date().toISOString();
  const overview = await getConnectorPublicationApprovalOverview(
    database,
    Date.parse(activatedAt),
  );
  if (overview.status !== "ready") return overview;
  const missingProviders = overview.providers
    .filter((entry) => entry.configured && entry.missingScopes.length > 0)
    .map((entry) => entry.provider);
  if (missingProviders.length > 0) {
    return { status: "incomplete", missingProviders };
  }
  const configuredProviders = overview.providers
    .filter((entry) => entry.configured)
    .map((entry) => entry.provider);
  const configuredCredentialProviders = new Set(
    configuredProviders.filter((provider) => provider !== "strava"),
  );
  const approvalRows = await Promise.all(
    configuredProviders.map(async (provider) => ({
      provider,
      row: await readSetting(
        database,
        connectorPublicationApprovalSettingKey(provider),
      ),
    })),
  );
  if (approvalRows.some(({ row }) => !row)) {
    return {
      status: "incomplete",
      missingProviders: approvalRows
        .filter(({ row }) => !row)
        .map(({ provider }) => provider),
    };
  }
  const enforcement: StoredEnforcement = {
    schemaVersion: 1,
    mode: "required",
    activatedAt,
  };
  const credentialProviders = PUBLIC_CONNECTOR_PROVIDERS.filter(
    (provider) => provider !== "strava",
  );
  const credentialPresenceGuards = credentialProviders.map((provider) =>
    configuredCredentialProviders.has(provider)
      ? `EXISTS (
           SELECT 1 FROM connector_credentials WHERE provider = ?
         )`
      : `NOT EXISTS (
           SELECT 1 FROM connector_credentials WHERE provider = ?
         )`,
  );
  const approvalGuards = approvalRows.map(
    () =>
      `EXISTS (
         SELECT 1 FROM editorial_settings
         WHERE key = ? AND value_json = ? AND updated_at = ?
       )`,
  );
  const activationGuardSql = [
    ...credentialPresenceGuards,
    `(SELECT COUNT(*) FROM editorial_settings WHERE key = ?) = ?`,
    ...approvalGuards,
  ].join(" AND ");
  const activationGuardBindings = [
    ...credentialProviders,
    STRAVA_SETTING_KEY,
    configuredProviders.includes("strava") ? 1 : 0,
    ...approvalRows.flatMap(({ provider, row }) => [
      connectorPublicationApprovalSettingKey(provider),
      row!.valueJson,
      row!.updatedAt,
    ]),
  ];
  try {
    const results = await database.batch([
      database
        .prepare(
          `INSERT INTO editorial_settings (
             key, value_json, updated_by_email, updated_at
           )
           SELECT ?, ?, ?, ?
           WHERE ${activationGuardSql}
           ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_by_email = excluded.updated_by_email,
             updated_at = excluded.updated_at`,
        )
        .bind(
          CONNECTOR_PUBLICATION_ENFORCEMENT_SETTING_KEY,
          JSON.stringify(enforcement),
          input.actorEmail,
          activatedAt,
          ...activationGuardBindings,
        ),
      database
        .prepare(
          `INSERT INTO audit_log (
             id, actor_email, action, entity_type, entity_id,
             details_json, created_at
           )
           SELECT ?, ?, 'connector.publication_approval_enforced',
                  'connector_policy', 'publication', ?, ?
           WHERE EXISTS (
             SELECT 1 FROM editorial_settings
             WHERE key = ? AND value_json = ? AND updated_at = ?
           )`,
        )
        .bind(
          crypto.randomUUID(),
          input.actorEmail,
          JSON.stringify({
            configuredProviders,
          }),
          activatedAt,
          CONNECTOR_PUBLICATION_ENFORCEMENT_SETTING_KEY,
          JSON.stringify(enforcement),
          activatedAt,
        ),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      const current = await getConnectorPublicationApprovalOverview(
        database,
        Date.parse(activatedAt),
      );
      if (current.status !== "ready") return current;
      const currentMissing = current.providers
        .filter((entry) => entry.configured && entry.missingScopes.length > 0)
        .map((entry) => entry.provider);
      return currentMissing.length > 0
        ? { status: "incomplete", missingProviders: currentMissing }
        : { status: "setup_required" };
    }
  } catch {
    return { status: "setup_required" };
  }
  const activatedOverview = await getConnectorPublicationApprovalOverview(
    database,
    Date.parse(activatedAt),
  );
  return activatedOverview.status === "ready" &&
    activatedOverview.enforcement.mode === "required" &&
    activatedOverview.enforcement.activatedAt === activatedAt &&
    activatedOverview.activationReady
    ? {
        status: "activated",
        enforcement: activatedOverview.enforcement,
        approvalStateDigest: activatedOverview.approvalStateDigest,
      }
    : { status: "setup_required" };
}

export async function deleteConnectorPublicationApproval(
  provider: PublicConnectorProvider,
  database: D1Database,
): Promise<void> {
  await database.batch([
    database
      .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
      .bind(connectorPublicationApprovalSettingKey(provider)),
    database
      .prepare(`DELETE FROM editorial_settings WHERE key = ?`)
      .bind(connectorPublicationApprovalPendingSettingKey(provider)),
  ]);
}
