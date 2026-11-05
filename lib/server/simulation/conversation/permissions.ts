import { z } from "zod";
import { decryptCredential, encryptCredential } from "../../credential-crypto";
import { runtimeValue } from "../../runtime-env";
import {
  conversationDatabase,
  ConversationError,
  keyContext,
} from "./settings";

export const GOOGLE_COLLECTIONS = [
  "myanimelist",
  "hardcover",
  "spotify",
  "discogs",
  "steam",
] as const;
const approval = z
  .object({
    provider: z.enum(GOOGLE_COLLECTIONS),
    processor: z.literal("google-gemini"),
    scope: z.enum(["collection_summary_processing", "network-v1"]),
    purposes: z
      .array(z.enum(["game_display", "google_gemini_processing"]))
      .max(2)
      .default([]),
    approvedAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    enabled: z.boolean(),
    revision: z.number().int().positive(),
    configurationRevision: z.string().length(64),
    reference: z
      .object({
        ciphertext: z.string(),
        iv: z.string(),
        keyVersion: z.literal("v1"),
      })
      .strict(),
  })
  .strict();
type Approval = z.infer<typeof approval>;
const prefix = "simulation:google-permission:";
export async function googleCollectionPermissions(
  database = conversationDatabase(),
) {
  const result = await database
    .prepare(
      "SELECT value_json AS valueJson FROM editorial_settings WHERE key LIKE ?",
    )
    .bind(`${prefix}%`)
    .all<{ valueJson: string }>();
  return (result.results ?? []).flatMap((row) => {
    try {
      const parsed = approval.safeParse(JSON.parse(row.valueJson));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}
export function activeGooglePermission(record: Approval, now = Date.now()) {
  return (
    record.enabled &&
    Date.parse(record.approvedAt) <= now &&
    (!record.expiresAt || Date.parse(record.expiresAt) > now)
  );
}
export function publicGooglePermission({
  provider,
  processor,
  scope,
  purposes,
  approvedAt,
  expiresAt,
  enabled,
  revision,
}: Approval) {
  return {
    provider,
    processor,
    scope,
    purposes,
    approvedAt,
    expiresAt,
    enabled,
    revision,
    referenceStored: true,
  };
}
export async function googlePermissionSummaries(
  database = conversationDatabase(),
) {
  const active = new Set(await verifiedGooglePermissions(database));
  const game = new Set(
    await verifiedGooglePermissions(database, "game_display"),
  );
  return (await googleCollectionPermissions(database)).map((record) => ({
    ...publicGooglePermission(record),
    active: active.has(record.provider),
    gameDisplayActive: game.has(record.provider),
  }));
}
async function connectionRevision(provider: string, database: D1Database) {
  const row = await database
    .prepare(
      "SELECT generation, iv FROM connector_credentials WHERE provider = ? LIMIT 1",
    )
    .bind(provider)
    .first<{ generation: number; iv: string }>();
  if (!row) return null;
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([provider, row.generation, row.iv]),
      ),
    ),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
export const permissionInput = z
  .object({
    provider: z.enum(GOOGLE_COLLECTIONS),
    reference: z.string().min(1).max(512).optional(),
    approvedAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    enabled: z.boolean(),
    purposes: z
      .array(z.enum(["game_display", "google_gemini_processing"]))
      .max(2),
  })
  .strict();
export async function saveGooglePermission(
  input: z.infer<typeof permissionInput>,
  expected: number,
  owner: string,
) {
  const database = conversationDatabase();
  if (
    Date.parse(input.approvedAt) > Date.now() ||
    (input.expiresAt &&
      Date.parse(input.expiresAt) <= Date.parse(input.approvedAt))
  )
    throw new ConversationError("permission_dates_invalid");
  const key = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!key) throw new ConversationError("setup_required", 503);
  const configurationRevision = await connectionRevision(
    input.provider,
    database,
  );
  if (!configurationRevision)
    throw new ConversationError("connection_required", 409);
  const previous = (await googleCollectionPermissions(database)).find(
    (record) => record.provider === input.provider,
  );
  if (
    !input.reference &&
    input.purposes.some((purpose) => !previous?.purposes.includes(purpose))
  )
    throw new ConversationError("reference_required");
  if (
    !input.reference &&
    (!previous || previous.configurationRevision !== configurationRevision)
  )
    throw new ConversationError("reference_required");
  const reference = input.reference
    ? await encryptCredential(
        input.reference,
        key,
        `${keyContext()}:permission:${input.provider}`,
      )
    : previous!.reference;
  const record: Approval = {
    provider: input.provider,
    processor: "google-gemini",
    scope: "network-v1",
    purposes: [...new Set(input.purposes)],
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt,
    enabled: input.enabled,
    revision: expected + 1,
    configurationRevision,
    reference,
  };
  const value = JSON.stringify(record),
    now = new Date().toISOString();
  const result =
    expected === 0
      ? await database
          .prepare(
            "INSERT INTO editorial_settings (key, value_json, updated_by_email, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING",
          )
          .bind(prefix + input.provider, value, owner, now)
          .run()
      : await database
          .prepare(
            "UPDATE editorial_settings SET value_json = ?, updated_by_email = ?, updated_at = ? WHERE key = ? AND json_extract(value_json, '$.revision') = ?",
          )
          .bind(value, owner, now, prefix + input.provider, expected)
          .run();
  if (result.meta.changes !== 1)
    throw new ConversationError("revision_conflict", 409);
  return publicGooglePermission(record);
}
export async function verifiedGooglePermissions(
  database = conversationDatabase(),
  purpose:
    | "game_display"
    | "google_gemini_processing" = "google_gemini_processing",
) {
  const key = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!key) return [];
  const eligible = (await googleCollectionPermissions(database)).filter(
    (record) =>
      activeGooglePermission(record) &&
      record.scope === "network-v1" &&
      record.purposes.includes(purpose),
  );
  return (
    await Promise.all(
      eligible.map(async (record) => {
        try {
          if (
            record.configurationRevision !==
            (await connectionRevision(record.provider, database))
          )
            return null;
          const reference = await decryptCredential<unknown>(
            record.reference,
            key,
            `${keyContext()}:permission:${record.provider}`,
          );
          return typeof reference === "string" && reference.length > 0
            ? record.provider
            : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter(
    (provider): provider is (typeof GOOGLE_COLLECTIONS)[number] =>
      provider !== null,
  );
}
