import { createHash } from "node:crypto";

export const PUBLIC_SITE_ORIGIN = "https://anish-shah-is.online";
export const PUBLIC_CLOUDFLARE_ACCOUNT_ID =
  "690e6286eb53a6df1bd0080633caf91f";

export const PRODUCTION_RESOURCE_FINGERPRINTS = Object.freeze({
  databaseIdSha256:
    "7cbb238b780bae20cc1b8ac679db25c7028f7e078fe5602e1317c6349f170e02",
  publicationCacheIdSha256:
    "f47e24ae3f20413c8550060723bfcac3494cc2b0551833e209d214a73a0f06bd",
  accessAudienceSha256:
    "282a7c919b63ca1540a84c8e953156af56edaf66fb059b654da6bf2ef2727d61",
});

export const PRODUCTION_RATE_LIMITS = Object.freeze([
  ["OWNER_RATE_LIMITER", { namespaceId: "88001001", limit: 30 }],
  ["ARTWORK_RATE_LIMITER", { namespaceId: "88001002", limit: 120 }],
  ["PROMOTION_RATE_LIMITER", { namespaceId: "88001003", limit: 6 }],
  ["OAUTH_CALLBACK_RATE_LIMITER", { namespaceId: "88001004", limit: 20 }],
]);
const RATE_LIMITS = new Map(PRODUCTION_RATE_LIMITS);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertPinnedProductionResources({
  databaseId,
  publicationCacheId,
  audiences,
}) {
  if (
    sha256(databaseId.toLowerCase()) !==
      PRODUCTION_RESOURCE_FINGERPRINTS.databaseIdSha256 ||
    sha256(publicationCacheId.toLowerCase()) !==
      PRODUCTION_RESOURCE_FINGERPRINTS.publicationCacheIdSha256 ||
    audiences.length !== 1 ||
    sha256(audiences[0]) !==
      PRODUCTION_RESOURCE_FINGERPRINTS.accessAudienceSha256
  ) {
    throw new Error(
      "Production D1, KV, and Access resources must match the pinned deployment contract.",
    );
  }
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for release preflight.`);
  return value;
}

export function requiredHostedPlayExperienceMode(env) {
  const playExperienceMode = required(env, "PLAY_EXPERIENCE_MODE");
  if (
    playExperienceMode !== "classic" &&
    playExperienceMode !== "my-room-2001"
  ) {
    throw new Error(
      "Hosted PLAY_EXPERIENCE_MODE must be explicitly set to classic or my-room-2001.",
    );
  }
  return playExperienceMode;
}

function exactHttpsOrigin(value, name) {
  let url;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw new Error(`${name} must be a valid HTTPS origin.`);
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error(`${name} must be an exact HTTPS origin.`);
  }
  return url.origin;
}

export function expectedPublicReleaseConfig(env, { head, contentVersion }) {
  const siteUrl = exactHttpsOrigin(required(env, "PUBLIC_SITE_URL"), "PUBLIC_SITE_URL");
  if (siteUrl !== PUBLIC_SITE_ORIGIN) {
    throw new Error("PUBLIC_SITE_URL must be the repository's pinned canonical origin.");
  }
  const teamDomain = exactHttpsOrigin(
    required(env, "CF_ACCESS_TEAM_DOMAIN"),
    "CF_ACCESS_TEAM_DOMAIN",
  );
  if (!new URL(teamDomain).hostname.endsWith(".cloudflareaccess.com")) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN must be a Cloudflare Access team origin.");
  }
  const ownerEmails = [...new Set(
    required(env, "OWNER_EMAILS")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];
  if (
    !ownerEmails.length ||
    ownerEmails.some((value) => value.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(value))
  ) {
    throw new Error("OWNER_EMAILS must contain valid exact-match addresses.");
  }
  const audiences = required(env, "CF_ACCESS_AUD")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !audiences.length ||
    audiences.some((value) => !/^[A-Za-z0-9_-]{8,160}$/.test(value))
  ) {
    throw new Error("CF_ACCESS_AUD must contain valid Access audiences.");
  }
  const databaseId = required(env, "CLOUDFLARE_D1_DATABASE_ID");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(databaseId)) {
    throw new Error("CLOUDFLARE_D1_DATABASE_ID must be a D1 UUID.");
  }
  const publicationCacheId = required(env, "CLOUDFLARE_PUBLICATION_CACHE_ID");
  if (!/^[0-9a-f]{32}$/i.test(publicationCacheId)) {
    throw new Error("CLOUDFLARE_PUBLICATION_CACHE_ID must be a KV namespace ID.");
  }
  assertPinnedProductionResources({
    databaseId,
    publicationCacheId,
    audiences,
  });
  const databaseName =
    env.CLOUDFLARE_D1_DATABASE_NAME?.trim() || "anish-shah-work-in-public";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(databaseName)) {
    throw new Error("CLOUDFLARE_D1_DATABASE_NAME is invalid.");
  }
  const playExperienceMode = requiredHostedPlayExperienceMode(env);
  const simulationExperienceMode =
    env.SIMULATION_EXPERIENCE_MODE?.trim() || "disabled";
  if (
    simulationExperienceMode !== "disabled" &&
    simulationExperienceMode !== "campaign-v1"
  ) {
    throw new Error(
      "SIMULATION_EXPERIENCE_MODE must be disabled or campaign-v1.",
    );
  }
  const simulationAiMode =
    env.SIMULATION_AI_MODE?.trim() ||
    (simulationExperienceMode === "campaign-v1" ? "live" : "authored-only");
  if (
    simulationAiMode !== "live" &&
    simulationAiMode !== "authored-only"
  ) {
    throw new Error(
      "Production SIMULATION_AI_MODE must be live or authored-only.",
    );
  }
  if (
    simulationExperienceMode === "campaign-v1" &&
    simulationAiMode !== "live"
  ) {
    throw new Error(
      "An enabled production simulation must use live AI with authored fallback.",
    );
  }
  return {
    head,
    contentVersion,
    siteUrl,
    teamDomain,
    ownerEmails: ownerEmails.join(","),
    audiences: audiences.join(","),
    databaseId,
    databaseName,
    publicationCacheId,
    playExperienceMode,
    simulationExperienceMode,
    simulationAiMode,
    accountId: PUBLIC_CLOUDFLARE_ACCOUNT_ID,
  };
}

export function assertPublicReleaseConfig(config, expected) {
  const vars = config?.vars ?? {};
  const expectedVars = {
    AUTH_MODE: "cloudflare_access",
    CF_ACCESS_AUD: expected.audiences,
    CF_ACCESS_TEAM_DOMAIN: expected.teamDomain,
    NODE_ENV: "production",
    OWNER_EMAILS: expected.ownerEmails,
    PRODUCTION_SITE_URL: expected.siteUrl,
    SITE_URL: expected.siteUrl,
    STEAM_DATA_STORAGE_COUNTRIES: "United States",
    RELEASE_SHA: expected.head,
    CONTENT_VERSION: expected.contentVersion,
    PUBLIC_CONTENT_MODE: "d1_kv_required",
    DEPLOYMENT_TIER: "production",
    PLAY_EXPERIENCE_MODE: expected.playExperienceMode,
    SIMULATION_EXPERIENCE_MODE: expected.simulationExperienceMode,
    SIMULATION_AI_MODE: expected.simulationAiMode,
    SIMULATION_PROVIDER: "anthropic",
    SIMULATION_MODEL: "claude-sonnet-5",
  };
  const exactVars =
    JSON.stringify(Object.keys(vars).sort()) ===
      JSON.stringify(Object.keys(expectedVars).sort()) &&
    Object.entries(expectedVars).every(([name, value]) => vars[name] === value);
  const database = config?.d1_databases?.[0];
  const publicationCache = config?.kv_namespaces?.[0];
  const rateLimits = new Map(
    Array.isArray(config?.ratelimits)
      ? config.ratelimits.map((binding) => [binding?.name, binding])
      : [],
  );
  const exactRateLimits =
    rateLimits.size === RATE_LIMITS.size &&
    [...RATE_LIMITS].every(([name, expectedRate]) => {
      const actual = rateLimits.get(name);
      return (
        actual?.namespace_id === expectedRate.namespaceId &&
        actual?.simple?.limit === expectedRate.limit &&
        actual?.simple?.period === 60
      );
    });
  if (
    config?.name !== "anish-shah-work-in-public" ||
    config?.topLevelName !== "anish-shah-work-in-public" ||
    config?.account_id !== expected.accountId ||
    config?.workers_dev !== false ||
    config?.preview_urls !== false ||
    JSON.stringify(config?.routes) !==
      JSON.stringify([{ pattern: "anish-shah-is.online", custom_domain: true }]) ||
    config?.d1_databases?.length !== 1 ||
    database?.binding !== "DB" ||
    database?.database_id !== expected.databaseId ||
    database?.database_name !== expected.databaseName ||
    database?.migrations_dir !== "../../drizzle" ||
    config?.kv_namespaces?.length !== 1 ||
    publicationCache?.binding !== "PUBLICATION_CACHE" ||
    publicationCache?.id !== expected.publicationCacheId ||
    !exactRateLimits ||
    !exactVars ||
    config?.observability?.enabled !== true ||
    config?.observability?.head_sampling_rate !== 1 ||
    config?.observability?.logs?.enabled !== true ||
    config?.observability?.logs?.invocation_logs !== false ||
    JSON.stringify(config?.triggers?.crons) !== JSON.stringify(["17 * * * *"])
  ) {
    throw new Error(
      "Prepared Worker configuration does not satisfy the exact public-release boundary.",
    );
  }
}
