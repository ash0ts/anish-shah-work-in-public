import { env } from "cloudflare:workers";

type RuntimeBindings = {
  DB?: D1Database;
  PUBLICATION_CACHE?: KVNamespace;
  SIMULATION_RATE_LIMITER?: RateLimitBinding;
  TRAVEL_MEDIA?: R2Bucket;
  IMAGES?: ImagesBinding;
  NODE_ENV?: string;
  OWNER_EMAILS?: string;
  CONNECTOR_ENCRYPTION_KEY?: string;
  STEAM_DATA_STORAGE_COUNTRIES?: string;
  SITE_URL?: string;
  PRODUCTION_SITE_URL?: string;
  AUTH_MODE?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  RELEASE_SHA?: string;
  CONTENT_VERSION?: string;
  PUBLIC_CONTENT_MODE?: string;
  DEPLOYMENT_TIER?: string;
  PREVIEW_PR_NUMBER?: string;
  PLAY_EXPERIENCE_MODE?: string;
  SIMULATION_EXPERIENCE_MODE?: string;
  SIMULATION_AI_MODE?: string;
  SIMULATION_AI_TRANSPORT?: string;
  SIMULATION_PROVIDER?: string;
  SIMULATION_MODEL?: string;
  SIMULATION_SESSION_HMAC_KEY?: string;
  SIMULATION_GATEWAY_ACCOUNT_ID?: string;
  SIMULATION_GATEWAY_ID?: string;
  SIMULATION_GATEWAY_TOKEN?: string;
  SIMULATION_GATEWAY_BYOK_ALIAS?: string;
  SIMULATION_LOCAL_ANTHROPIC_API_KEY?: string;
  SIMULATION_DAILY_MODEL_LIMIT?: string;
  TRAVEL_ATLAS_MODE?: string;
};

function cloudflareBindings(): RuntimeBindings {
  try {
    return env as unknown as RuntimeBindings;
  } catch {
    return {};
  }
}

export function runtimeValue(
  name: Exclude<
    keyof RuntimeBindings,
    | "DB"
    | "PUBLICATION_CACHE"
    | "SIMULATION_RATE_LIMITER"
    | "TRAVEL_MEDIA"
    | "IMAGES"
  >,
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

export function runtimePublicationKv(): KVNamespace | null {
  return cloudflareBindings().PUBLICATION_CACHE ?? null;
}

export function runtimeTravelMedia(): R2Bucket | null {
  return cloudflareBindings().TRAVEL_MEDIA ?? null;
}

export function runtimeImages(): ImagesBinding | null {
  return cloudflareBindings().IMAGES ?? null;
}
