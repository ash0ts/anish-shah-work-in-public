export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  keyVersion: "v1";
};

const IV_BYTES = 12;
const KEY_BYTES = 32;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error(
      "CONNECTOR_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
    );
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  return copied.buffer;
}

async function importEncryptionKey(base64Key: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(base64Key);
  if (keyBytes.byteLength !== KEY_BYTES) {
    throw new Error(
      "CONNECTOR_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }

  return crypto.subtle.importKey(
    "raw",
    asArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function additionalData(context: string): Uint8Array {
  return new TextEncoder().encode(`anish-site:connector:${context}:v1`);
}

export async function encryptCredential(
  value: unknown,
  base64Key: string,
  context: string,
): Promise<EncryptedCredential> {
  const key = await importEncryptionKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(iv),
      additionalData: asArrayBuffer(additionalData(context)),
    },
    key,
    asArrayBuffer(plaintext),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    keyVersion: "v1",
  };
}

export async function decryptCredential<T>(
  encrypted: EncryptedCredential,
  base64Key: string,
  context: string,
): Promise<T> {
  if (encrypted.keyVersion !== "v1") {
    throw new Error(`Unsupported connector key version: ${encrypted.keyVersion}`);
  }

  const key = await importEncryptionKey(base64Key);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(base64ToBytes(encrypted.iv)),
      additionalData: asArrayBuffer(additionalData(context)),
    },
    key,
    asArrayBuffer(base64ToBytes(encrypted.ciphertext)),
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
