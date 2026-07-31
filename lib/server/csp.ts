import { headers } from "next/headers.js";

const INTERNAL_NONCE_HEADER = "x-anish-csp-nonce";

/** Returns only the Worker-generated nonce; untrusted input is stripped first. */
export async function requestCspNonce(): Promise<string | undefined> {
  const value = (await headers()).get(INTERNAL_NONCE_HEADER)?.trim();
  return value && /^[A-Za-z0-9+/]{24}$/.test(value) ? value : undefined;
}
