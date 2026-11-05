import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runtimeValue } from "../../runtime-env";
import { conversationDatabase, ConversationError } from "./settings";

const KEY = "simulation:access:v1";
export const ACCESS_COOKIE = "__Host-anish_network_access";
const stored = z
  .object({
    version: z.literal(1),
    revision: z.number().int().positive(),
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    enabled: z.boolean(),
  })
  .strict();
type Access = z.infer<typeof stored>;
export const passwordInput = z
  .string()
  .min(16)
  .max(128)
  .refine((v) => v.trim().length >= 16);
const context = () =>
  `${runtimeValue("DEPLOYMENT_TIER") ?? "local"}:${new URL(runtimeValue("SITE_URL") ?? "http://localhost:3000").origin}`;
function signingKey() {
  const secret = runtimeValue("SIMULATION_SESSION_HMAC_KEY");
  if (!secret || !/^[A-Za-z0-9+/]{43}=$/.test(secret))
    throw new ConversationError("setup_required", 503);
  return Buffer.from(secret, "base64");
}
let activeHashes = 0;
async function digest(password: string, salt: string): Promise<Buffer> {
  // OWASP's memory-constrained scrypt profile: 16 MiB, five passes. Native
  // node:crypto is supported by workerd; no password hashing reaches the client.
  if (activeHashes >= 2) throw new ConversationError("access_limited", 429);
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        `${context()}:${salt}`,
        32,
        { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 },
        (error, result) => (error ? reject(error) : resolve(result)),
      ),
    );
  } finally {
    activeHashes--;
  }
}
export async function readNetworkAccess(): Promise<Access | null> {
  const row = await conversationDatabase()
    .prepare(
      "SELECT value_json AS valueJson FROM editorial_settings WHERE key = ?",
    )
    .bind(KEY)
    .first<{ valueJson: string }>();
  if (!row) return null;
  try {
    return stored.parse(JSON.parse(row.valueJson));
  } catch {
    throw new ConversationError("configuration_invalid", 503);
  }
}
export function accessSummary(value: Access | null) {
  return {
    revision: value?.revision ?? 0,
    passwordStored: Boolean(value),
    enabled: value?.enabled ?? false,
  };
}
export async function saveNetworkAccess(
  input: { password?: string; enabled?: boolean },
  revision: number,
  owner: string,
) {
  signingKey();
  const current = await readNetworkAccess();
  if ((current?.revision ?? 0) !== revision)
    throw new ConversationError("revision_conflict", 409);
  if (!input.password && !current)
    throw new ConversationError("password_required", 409);
  if (input.password && !passwordInput.safeParse(input.password).success)
    throw new ConversationError("password_invalid");
  const salt = input.password ? randomBytes(16).toString("hex") : current!.salt;
  const hash = input.password
    ? (await digest(input.password, salt)).toString("hex")
    : current!.hash;
  const value = stored.parse({
    version: 1,
    revision: revision + 1,
    salt,
    hash,
    enabled: input.enabled ?? true,
  });
  const result = current
    ? await conversationDatabase()
        .prepare(
          "UPDATE editorial_settings SET value_json = ?, updated_by_email = ?, updated_at = ? WHERE key = ? AND json_extract(value_json, '$.revision') = ?",
        )
        .bind(
          JSON.stringify(value),
          owner,
          new Date().toISOString(),
          KEY,
          revision,
        )
        .run()
    : await conversationDatabase()
        .prepare(
          "INSERT INTO editorial_settings (key,value_json,updated_by_email,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO NOTHING",
        )
        .bind(KEY, JSON.stringify(value), owner, new Date().toISOString())
        .run();
  if (result.meta.changes !== 1)
    throw new ConversationError("revision_conflict", 409);
  return accessSummary(value);
}
export function accessCookie(token = "", age = 3600) {
  return `${ACCESS_COOKIE}=${token}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
}
function signature(payload: string) {
  return createHmac("sha256", signingKey())
    .update(`network-access:v1:${context()}:${payload}`)
    .digest();
}
export async function hasNetworkAccess(cookie: string, now = Date.now()) {
  const config = await readNetworkAccess();
  if (!config?.enabled) return false;
  const token =
    cookie
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${ACCESS_COOKIE}=`))
      ?.slice(ACCESS_COOKIE.length + 1) ?? "";
  const match = /^(\d{1,10})\.(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(
    token,
  );
  if (
    !match ||
    Number(match[1]) !== config.revision ||
    Number(match[2]) <= now ||
    Number(match[2]) > now + 3_600_000
  )
    return false;
  return timingSafeEqual(
    signature(token.slice(0, token.lastIndexOf("."))),
    Buffer.from(match[4], "hex"),
  );
}
export async function unlockNetwork(password: string, now = Date.now()) {
  // A fixed, bounded row caps expensive hashes across IPs. Worker rate limits
  // additionally limit each caller. No password or IP is stored in this row.
  const window = Math.floor(now / 60_000);
  const budget = await conversationDatabase()
    .prepare(
      `INSERT INTO editorial_settings (key,value_json,updated_by_email,updated_at)
    VALUES ('simulation:access-budget:v1', json_object('window', ?, 'attempts', 1), 'system', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = json_object('window', ?, 'attempts', CASE WHEN json_extract(value_json, '$.window') = ? THEN json_extract(value_json, '$.attempts') + 1 ELSE 1 END)
    WHERE json_extract(value_json, '$.window') != ? OR json_extract(value_json, '$.attempts') < 20`,
    )
    .bind(window, new Date(now).toISOString(), window, window, window)
    .run();
  if (budget.meta.changes !== 1)
    throw new ConversationError("access_limited", 429);
  const config = await readNetworkAccess();
  if (!config?.enabled || !passwordInput.safeParse(password).success)
    throw new ConversationError("access_denied", 401);
  const actual = await digest(password, config.salt);
  if (!timingSafeEqual(actual, Buffer.from(config.hash, "hex")))
    throw new ConversationError("access_denied", 401);
  const fresh = await readNetworkAccess();
  if (!fresh?.enabled || fresh.revision !== config.revision)
    throw new ConversationError("access_denied", 401);
  const payload = `${config.revision}.${now + 3_600_000}.${randomBytes(16).toString("hex")}`;
  return accessCookie(`${payload}.${signature(payload).toString("hex")}`);
}
