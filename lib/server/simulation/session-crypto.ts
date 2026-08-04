export const SIMULATION_COOKIE_NAME = "__Host-anish_simulation";

const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64Bytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const decoded = atob(value);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

export function validSimulationSessionHmacKey(value: string | undefined): boolean {
  return Boolean(value && base64Bytes(value));
}

export function createSimulationSessionToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function simulationSessionTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SIMULATION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return SESSION_TOKEN.test(value) ? value : null;
  }
  return null;
}

export async function hashSimulationSessionToken(
  token: string,
  secret: string,
): Promise<string> {
  if (!SESSION_TOKEN.test(token)) throw new Error("simulation_session_token_invalid");
  const keyBytes = base64Bytes(secret);
  if (!keyBytes) throw new Error("simulation_session_hmac_key_invalid");
  const keyData = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength,
  ) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)),
    ),
  );
}

export function simulationSessionCookie(token: string, maximumAge = 3_600): string {
  if (!SESSION_TOKEN.test(token)) throw new Error("simulation_session_token_invalid");
  return `${SIMULATION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maximumAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function expiredSimulationSessionCookie(): string {
  return `${SIMULATION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
