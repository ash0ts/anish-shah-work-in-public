import { createHash } from "node:crypto";
import {
  PUBLIC_CLOUDFLARE_ACCOUNT_ID,
  PUBLIC_SITE_ORIGIN,
  PRODUCTION_TRAVEL_MEDIA_BUCKET,
  PRODUCTION_RATE_LIMITS,
  PRODUCTION_RESOURCE_FINGERPRINTS,
} from "./release-config-contract.mjs";

export const STAGING_SITE_ORIGIN = "https://staging.anish-shah-is.online";
export const STAGING_WORKER_NAME = "anish-shah-work-in-public-staging";
export const PRODUCTION_WORKER_NAME = "anish-shah-work-in-public";

const PRODUCTION_RATE_LIMIT_NAMESPACES = new Set(
  PRODUCTION_RATE_LIMITS.map(([, binding]) => binding.namespaceId),
);
const PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const FORBIDDEN_GENERATED_BINDINGS = [
  "services",
  "queues",
  "r2_buckets",
  "images",
  "kv_namespaces",
  "vectorize",
  "ai_search_namespaces",
  "ai_search",
  "agent_memory",
  "hyperdrive",
  "workflows",
  "secrets_store_secrets",
  "artifacts",
  "analytics_engine_datasets",
  "unsafe_hello_world",
  "flagship",
  "ratelimits",
  "worker_loaders",
  "dispatch_namespaces",
  "send_email",
  "mtls_certificates",
  "pipelines",
  "vpc_services",
  "vpc_networks",
];

function nonEmpty(value) {
  if (Array.isArray(value)) return value.some(nonEmpty);
  if (value && typeof value === "object") {
    return Object.values(value).some(nonEmpty);
  }
  return value !== undefined && value !== null && value !== "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeGeneratedWorkerBase(base) {
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    throw new Error("The generated Worker base configuration is invalid.");
  }
  for (const name of FORBIDDEN_GENERATED_BINDINGS) {
    if (nonEmpty(base[name])) {
      throw new Error(`Generated Worker base contains forbidden ${name} bindings.`);
    }
  }
  const databases = base.d1_databases ?? [];
  if (
    !Array.isArray(databases) ||
    databases.length > 1 ||
    databases.some(
      (entry) =>
        entry?.binding !== "DB" ||
        entry?.database_id !== PLACEHOLDER_DATABASE_ID ||
        entry?.database_name !== "site-creator-d1",
    )
  ) {
    throw new Error("Generated Worker base contains a non-placeholder D1 binding.");
  }
  if (
    nonEmpty(base.vars) ||
    nonEmpty(base.durable_objects?.bindings) ||
    nonEmpty(base.triggers) ||
    base.main !== "index.js" ||
    base.no_bundle !== true ||
    JSON.stringify(base.assets) !== JSON.stringify({ directory: "../client" }) ||
    JSON.stringify(base.compatibility_flags) !== JSON.stringify(["nodejs_compat"]) ||
    base.jsx_factory !== "React.createElement" ||
    base.jsx_fragment !== "React.Fragment" ||
    JSON.stringify(base.rules) !==
      JSON.stringify([{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }]) ||
    typeof base.compatibility_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(base.compatibility_date)
  ) {
    throw new Error("Generated Worker base does not match the inert Vinext build contract.");
  }
  return {
    main: "index.js",
    compatibility_date: base.compatibility_date,
    compatibility_flags: ["nodejs_compat"],
    jsx_factory: "React.createElement",
    jsx_fragment: "React.Fragment",
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    assets: { directory: "../client" },
  };
}

export function exactHttpsOrigin(value, name) {
  let url;
  try {
    url = new URL(value);
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
    throw new Error(`${name} must be an exact HTTPS origin without a port or path.`);
  }
  return url.origin;
}

export function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function accessTeamDomain(value) {
  const origin = exactHttpsOrigin(
    value.includes("://") ? value : `https://${value}`,
    "CF_ACCESS_TEAM_DOMAIN",
  );
  if (!new URL(origin).hostname.endsWith(".cloudflareaccess.com")) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN must be a Cloudflare Access team domain.");
  }
  return origin;
}

function audiences(value, name) {
  const list = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!list.length || list.some((entry) => !/^[A-Za-z0-9_-]{8,160}$/.test(entry))) {
    throw new Error(`${name} must contain valid Access audiences.`);
  }
  return [...new Set(list)].join(",");
}

function emails(value) {
  const list = value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.some((entry) => entry.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(entry))) {
    throw new Error("OWNER_EMAILS must contain exact valid email addresses.");
  }
  return [...new Set(list)].join(",");
}

function uuid(value, name) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) {
    throw new Error(`${name} must be a D1 UUID.`);
  }
  return value.toLowerCase();
}

function kvId(value, name) {
  if (!/^[0-9a-f]{32}$/i.test(value)) {
    throw new Error(`${name} must be a KV namespace ID.`);
  }
  return value.toLowerCase();
}

function releaseMetadata(environment, contentVersion) {
  const releaseSha = required(environment, "RELEASE_VALIDATED_SHA").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    throw new Error("RELEASE_VALIDATED_SHA must be an exact commit SHA.");
  }
  if (!/^[a-f0-9]{16}$/.test(contentVersion)) {
    throw new Error("The public bundle content version is invalid.");
  }
  return { releaseSha, contentVersion };
}

export function expectedStagingCoordinates(environment, contentVersion) {
  const metadata = releaseMetadata(environment, contentVersion);
  const simulationExperienceMode =
    environment.STAGING_SIMULATION_EXPERIENCE_MODE?.trim() || "campaign-v1";
  if (!new Set(["disabled", "campaign-v1"]).has(simulationExperienceMode)) {
    throw new Error(
      "STAGING_SIMULATION_EXPERIENCE_MODE must be disabled or campaign-v1.",
    );
  }
  const simulationAiMode =
    simulationExperienceMode === "campaign-v1" ? "live" : "authored-only";
  const databaseId = uuid(
    required(environment, "STAGING_CLOUDFLARE_D1_DATABASE_ID"),
    "STAGING_CLOUDFLARE_D1_DATABASE_ID",
  );
  const publicationCacheId = kvId(
    required(environment, "STAGING_CLOUDFLARE_PUBLICATION_CACHE_ID"),
    "STAGING_CLOUDFLARE_PUBLICATION_CACHE_ID",
  );
  const travelMediaBucket = required(
    environment,
    "STAGING_CLOUDFLARE_TRAVEL_MEDIA_BUCKET",
  );
  if (
    !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(travelMediaBucket) ||
    travelMediaBucket === PRODUCTION_TRAVEL_MEDIA_BUCKET
  ) {
    throw new Error(
      "STAGING_CLOUDFLARE_TRAVEL_MEDIA_BUCKET must be a valid non-production R2 bucket name.",
    );
  }
  const accessAudience = audiences(
    required(environment, "STAGING_CF_ACCESS_AUD"),
    "STAGING_CF_ACCESS_AUD",
  );
  if (sha256(databaseId) === PRODUCTION_RESOURCE_FINGERPRINTS.databaseIdSha256) {
    throw new Error("Staging and production D1 identifiers must differ.");
  }
  if (
    sha256(publicationCacheId) ===
    PRODUCTION_RESOURCE_FINGERPRINTS.publicationCacheIdSha256
  ) {
    throw new Error("Staging and production KV identifiers must differ.");
  }
  if (
    accessAudience
      .split(",")
      .some(
        (value) =>
          sha256(value) ===
          PRODUCTION_RESOURCE_FINGERPRINTS.accessAudienceSha256,
      )
  ) {
    throw new Error("Staging and production Access audiences must differ.");
  }
  const rateLimits = [
    ["OWNER_RATE_LIMITER", "STAGING_OWNER_RATE_LIMIT_NAMESPACE_ID", 30],
    ["ARTWORK_RATE_LIMITER", "STAGING_ARTWORK_RATE_LIMIT_NAMESPACE_ID", 120],
    ["PROMOTION_RATE_LIMITER", "STAGING_PROMOTION_RATE_LIMIT_NAMESPACE_ID", 6],
    ["OAUTH_CALLBACK_RATE_LIMITER", "STAGING_OAUTH_CALLBACK_RATE_LIMIT_NAMESPACE_ID", 20],
    ["SIMULATION_RATE_LIMITER", "STAGING_SIMULATION_RATE_LIMIT_NAMESPACE_ID", 12],
    ["TRAVEL_MEDIA_RATE_LIMITER", "STAGING_TRAVEL_MEDIA_RATE_LIMIT_NAMESPACE_ID", 180],
  ].map(([name, environmentName, limit]) => {
    const namespaceId = required(environment, environmentName);
    if (!/^[0-9]{6,32}$/.test(namespaceId) || PRODUCTION_RATE_LIMIT_NAMESPACES.has(namespaceId)) {
      throw new Error(`${environmentName} must be a non-production numeric namespace.`);
    }
    return { name, namespaceId, limit };
  });
  if (new Set(rateLimits.map((entry) => entry.namespaceId)).size !== rateLimits.length) {
    throw new Error("Every staging rate-limit namespace must be unique.");
  }
  const databaseName = required(environment, "STAGING_CLOUDFLARE_D1_DATABASE_NAME");
  if (databaseName !== "anish-shah-work-in-public-staging") {
    throw new Error("The staging D1 database name must be anish-shah-work-in-public-staging.");
  }
  return {
    ...metadata,
    accountId: PUBLIC_CLOUDFLARE_ACCOUNT_ID,
    siteUrl: STAGING_SITE_ORIGIN,
    productionSiteUrl: PUBLIC_SITE_ORIGIN,
    databaseId,
    databaseName,
    publicationCacheId,
    accessAudience,
    teamDomain: accessTeamDomain(required(environment, "CF_ACCESS_TEAM_DOMAIN")),
    ownerEmails: emails(required(environment, "OWNER_EMAILS")),
    rateLimits,
    simulationExperienceMode,
    simulationAiMode,
    travelMediaBucket,
  };
}

export function expectedPreviewCoordinates(environment, contentVersion) {
  const metadata = releaseMetadata(environment, contentVersion);
  const prNumber = required(environment, "PREVIEW_PR_NUMBER");
  if (!/^[1-9][0-9]{0,6}$/.test(prNumber)) {
    throw new Error("PREVIEW_PR_NUMBER must be a positive GitHub PR number.");
  }
  return {
    ...metadata,
    accountId: PUBLIC_CLOUDFLARE_ACCOUNT_ID,
    prNumber,
    workerName: `anish-shah-work-in-public-pr-${prNumber}`,
    siteUrl: `https://pr-${prNumber}.anish-shah-is.online`,
    productionSiteUrl: PUBLIC_SITE_ORIGIN,
    accessAudience: audiences(
      required(environment, "PREVIEW_CF_ACCESS_AUD"),
      "PREVIEW_CF_ACCESS_AUD",
    ),
    teamDomain: accessTeamDomain(required(environment, "CF_ACCESS_TEAM_DOMAIN")),
  };
}

export function stagingConfiguration(base, expected) {
  return {
    ...safeGeneratedWorkerBase(base),
    name: STAGING_WORKER_NAME,
    topLevelName: STAGING_WORKER_NAME,
    account_id: expected.accountId,
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: new URL(expected.siteUrl).hostname, custom_domain: true }],
    d1_databases: [{
      binding: "DB",
      database_name: expected.databaseName,
      database_id: expected.databaseId,
      migrations_dir: "../../drizzle",
    }],
    kv_namespaces: [{ binding: "PUBLICATION_CACHE", id: expected.publicationCacheId }],
    r2_buckets: [{ binding: "TRAVEL_MEDIA", bucket_name: expected.travelMediaBucket }],
    images: { binding: "IMAGES" },
    ratelimits: expected.rateLimits.map(({ name, namespaceId, limit }) => ({
      name,
      namespace_id: namespaceId,
      simple: { limit, period: 60 },
    })),
    vars: {
      AUTH_MODE: "cloudflare_access",
      CF_ACCESS_AUD: expected.accessAudience,
      CF_ACCESS_TEAM_DOMAIN: expected.teamDomain,
      NODE_ENV: "production",
      OWNER_EMAILS: expected.ownerEmails,
      PRODUCTION_SITE_URL: expected.productionSiteUrl,
      SITE_URL: expected.siteUrl,
      STEAM_DATA_STORAGE_COUNTRIES: "United States",
      RELEASE_SHA: expected.releaseSha,
      CONTENT_VERSION: expected.contentVersion,
      PUBLIC_CONTENT_MODE: "d1_kv_required",
      DEPLOYMENT_TIER: "staging",
      PLAY_EXPERIENCE_MODE: "my-room-2001",
      SIMULATION_EXPERIENCE_MODE: expected.simulationExperienceMode,
      SIMULATION_AI_MODE: expected.simulationAiMode,
      SIMULATION_PROVIDER: "anthropic",
      SIMULATION_MODEL: "claude-sonnet-5",
      TRAVEL_ATLAS_MODE: "atlas-v1",
    },
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: { enabled: true, invocation_logs: false },
    },
    triggers: { crons: ["47 * * * *"] },
  };
}

export function previewConfiguration(base, expected) {
  const config = {
    ...safeGeneratedWorkerBase(base),
    name: expected.workerName,
    topLevelName: expected.workerName,
    account_id: expected.accountId,
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: new URL(expected.siteUrl).hostname, custom_domain: true }],
    d1_databases: [],
    kv_namespaces: [],
    ratelimits: [],
    vars: {
      AUTH_MODE: "cloudflare_access",
      CF_ACCESS_AUD: expected.accessAudience,
      CF_ACCESS_TEAM_DOMAIN: expected.teamDomain,
      NODE_ENV: "production",
      PRODUCTION_SITE_URL: expected.productionSiteUrl,
      SITE_URL: expected.siteUrl,
      RELEASE_SHA: expected.releaseSha,
      CONTENT_VERSION: expected.contentVersion,
      PUBLIC_CONTENT_MODE: "static_preview",
      DEPLOYMENT_TIER: "preview",
      PREVIEW_PR_NUMBER: expected.prNumber,
      PLAY_EXPERIENCE_MODE: "my-room-2001",
      SIMULATION_EXPERIENCE_MODE: "campaign-v1",
      SIMULATION_AI_MODE: "fixture",
      SIMULATION_PROVIDER: "fixture",
      SIMULATION_MODEL: "authored-fixture-v1",
      TRAVEL_ATLAS_MODE: "atlas-v1",
    },
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: { enabled: true, invocation_logs: false },
    },
  };
  delete config.triggers;
  return config;
}

export function assertStagingConfiguration(config, expected) {
  const canonical = stagingConfiguration(assertionBase(config), expected);
  if (JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(Object.keys(canonical).sort())) {
    throw new Error("Prepared staging configuration contains unexpected top-level fields.");
  }
  for (const key of [
    "name", "topLevelName", "account_id", "workers_dev", "preview_urls",
    "routes", "d1_databases", "kv_namespaces", "r2_buckets", "images", "ratelimits", "vars",
    "observability", "triggers",
  ]) {
    if (JSON.stringify(config[key]) !== JSON.stringify(canonical[key])) {
      throw new Error("Prepared staging configuration crossed an environment boundary.");
    }
  }
}

export function assertPreviewConfiguration(config, expected) {
  const canonical = previewConfiguration(assertionBase(config), expected);
  if (JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(Object.keys(canonical).sort())) {
    throw new Error("Prepared preview configuration contains unexpected top-level fields.");
  }
  for (const key of [
    "name", "topLevelName", "account_id", "workers_dev", "preview_urls",
    "routes", "d1_databases", "kv_namespaces", "ratelimits", "vars",
    "observability",
  ]) {
    if (JSON.stringify(config[key]) !== JSON.stringify(canonical[key])) {
      throw new Error("Prepared preview configuration crossed an environment boundary.");
    }
  }
  if (config.triggers) {
    throw new Error("Preview configuration must not contain scheduled triggers.");
  }
}

function assertionBase(config) {
  return {
    main: config.main,
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    jsx_factory: config.jsx_factory,
    jsx_fragment: config.jsx_fragment,
    no_bundle: config.no_bundle,
    rules: config.rules,
    assets: config.assets,
    vars: {},
    triggers: {},
    durable_objects: { bindings: [] },
    d1_databases: [{
      binding: "DB",
      database_name: "site-creator-d1",
      database_id: PLACEHOLDER_DATABASE_ID,
    }],
  };
}
