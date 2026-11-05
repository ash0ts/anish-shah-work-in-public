import { z } from "zod";
import { runtimeDatabase, runtimeValue } from "../../runtime-env";
import { encryptCredential, decryptCredential } from "../../credential-crypto";

export const GEMINI_MODEL = "gemini-3.6-flash" as const;
const KEY = "simulation:google-config:v2";
const encrypted = z
  .object({
    ciphertext: z.string().max(4096),
    iv: z.string().max(64),
    keyVersion: z.literal("v1"),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(2),
    revision: z.number().int().nonnegative(),
    encryptedKey: encrypted.nullable(),
    tested: z.boolean(),
    enabled: z.boolean(),
    testingUntil: z.string().datetime().nullable(),
  })
  .strict();
export type GeminiConfiguration = z.infer<typeof schema>;
const EMPTY: GeminiConfiguration = {
  schemaVersion: 2,
  revision: 0,
  encryptedKey: null,
  tested: false,
  enabled: false,
  testingUntil: null,
};
export class ConversationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function conversationDatabase() {
  const database = runtimeDatabase();
  if (!database) throw new ConversationError("setup_required", 503);
  return database;
}
export function keyContext() {
  const tier = runtimeValue("DEPLOYMENT_TIER") ?? "local";
  const origin = new URL(runtimeValue("SITE_URL") ?? "http://localhost:3000")
    .origin;
  return `simulation:google:${tier}:${origin}:v2`;
}
function encryptionKey() {
  const key = runtimeValue("CONNECTOR_ENCRYPTION_KEY");
  if (!key) throw new ConversationError("setup_required", 503);
  return key;
}
export async function readGeminiConfiguration(
  database = conversationDatabase(),
): Promise<GeminiConfiguration> {
  const row = await database
    .prepare(
      "SELECT value_json AS valueJson FROM editorial_settings WHERE key = ? LIMIT 1",
    )
    .bind(KEY)
    .first<{ valueJson: string }>();
  if (!row) return { ...EMPTY };
  try {
    return schema.parse(JSON.parse(row.valueJson));
  } catch {
    throw new ConversationError("configuration_invalid", 503);
  }
}
export function publicGeminiConfiguration(config: GeminiConfiguration) {
  return {
    revision: config.revision,
    keyStored: Boolean(config.encryptedKey),
    tested: config.tested,
    enabled: config.enabled,
    testing: Boolean(
      config.testingUntil && Date.parse(config.testingUntil) > Date.now(),
    ),
    provider: "google",
    model: GEMINI_MODEL,
  };
}
export async function writeGeminiConfiguration(
  next: GeminiConfiguration,
  expectedRevision: number,
  owner: string,
  database = conversationDatabase(),
) {
  const current = await readGeminiConfiguration(database);
  if (current.revision !== expectedRevision)
    throw new ConversationError("revision_conflict", 409);
  const value = JSON.stringify({ ...next, revision: expectedRevision + 1 });
  const now = new Date().toISOString();
  const result =
    expectedRevision === 0 && !current.encryptedKey
      ? await database
          .prepare(
            `INSERT INTO editorial_settings (key, value_json, updated_by_email, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`,
          )
          .bind(KEY, value, owner, now)
          .run()
      : await database
          .prepare(
            `UPDATE editorial_settings SET value_json = ?, updated_by_email = ?, updated_at = ? WHERE key = ? AND json_extract(value_json, '$.revision') = ?`,
          )
          .bind(value, owner, now, KEY, expectedRevision)
          .run();
  if (result.meta.changes !== 1)
    throw new ConversationError("revision_conflict", 409);
  return schema.parse(JSON.parse(value));
}
export async function saveGeminiKey(
  key: string,
  revision: number,
  owner: string,
) {
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(key))
    throw new ConversationError("key_invalid");
  const sealed = await encryptCredential(
    { key },
    encryptionKey(),
    keyContext(),
  );
  return writeGeminiConfiguration(
    { ...EMPTY, encryptedKey: sealed },
    revision,
    owner,
  );
}
export async function decryptGeminiKey(
  config: GeminiConfiguration,
): Promise<string | null> {
  if (!config.encryptedKey) return null;
  try {
    const value = await decryptCredential<{ key: string }>(
      config.encryptedKey,
      encryptionKey(),
      keyContext(),
    );
    return /^[A-Za-z0-9_-]{20,256}$/.test(value.key) ? value.key : null;
  } catch {
    return null;
  }
}
