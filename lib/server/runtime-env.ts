import { env } from "cloudflare:workers";

type RuntimeBindings = {
  DB?: D1Database;
  OWNER_EMAILS?: string;
  CONNECTOR_ENCRYPTION_KEY?: string;
  MYANIMELIST_PROFILE_URL?: string;
  HARDCOVER_PROFILE_URL?: string;
  STEAM_DATA_STORAGE_COUNTRIES?: string;
};

function cloudflareBindings(): RuntimeBindings {
  try {
    return env as unknown as RuntimeBindings;
  } catch {
    return {};
  }
}

export function runtimeValue(
  name: Exclude<keyof RuntimeBindings, "DB">,
): string | undefined {
  const cloudflareValue = cloudflareBindings()[name];
  if (typeof cloudflareValue === "string" && cloudflareValue.trim()) {
    return cloudflareValue.trim();
  }

  const processValue = process.env[name];
  return processValue?.trim() || undefined;
}

export function runtimeDatabase(): D1Database | null {
  return cloudflareBindings().DB ?? null;
}
