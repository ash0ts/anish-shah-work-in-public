import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const generatedConfigPath = resolve(root, "dist/server/wrangler.json");
const releaseConfigPath = resolve(root, "dist/server/wrangler.public.json");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to prepare a public release.`);
  return value;
}

function exactHttpsOrigin(value, name) {
  const url = new URL(value);
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

await access(generatedConfigPath).catch(() => {
  throw new Error("Run the production build before preparing Cloudflare release config.");
});

if (process.env.LOCAL_OWNER_EMAIL?.trim()) {
  throw new Error("LOCAL_OWNER_EMAIL must not be present in a production release shell.");
}

const databaseId = required("CLOUDFLARE_D1_DATABASE_ID");
if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(databaseId)) {
  throw new Error("CLOUDFLARE_D1_DATABASE_ID must be a D1 UUID.");
}
const publicationKvId = required("CLOUDFLARE_PUBLICATION_CACHE_ID");
if (!/^[0-9a-f]{32}$/i.test(publicationKvId)) {
  throw new Error("CLOUDFLARE_PUBLICATION_CACHE_ID must be a KV namespace ID.");
}
const databaseName =
  process.env.CLOUDFLARE_D1_DATABASE_NAME?.trim() ||
  "anish-shah-work-in-public";
if (!/^[a-z0-9_-]{1,64}$/i.test(databaseName)) {
  throw new Error("CLOUDFLARE_D1_DATABASE_NAME is invalid.");
}
const ownerEmails = required("OWNER_EMAILS")
  .split(",")
  .map((value) => value.trim().toLocaleLowerCase())
  .filter(Boolean);
if (
  !ownerEmails.length ||
  ownerEmails.some((value) => value.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(value))
) {
  throw new Error("OWNER_EMAILS must contain valid exact-match email addresses.");
}
const audiences = required("CF_ACCESS_AUD")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!audiences.length || audiences.some((value) => !/^[A-Za-z0-9_-]{8,160}$/.test(value))) {
  throw new Error("CF_ACCESS_AUD must contain valid Access application audiences.");
}

const publicSiteUrl = exactHttpsOrigin(
  required("PUBLIC_SITE_URL"),
  "PUBLIC_SITE_URL",
);
const releaseSha = required("RELEASE_VALIDATED_SHA").toLowerCase();
if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
  throw new Error("RELEASE_VALIDATED_SHA must be an exact 40-character commit SHA.");
}
const publicBundle = JSON.parse(
  await readFile(
    resolve(root, "content/public/anish-content.public.v1.json"),
    "utf8",
  ),
);
if (!/^[a-f0-9]{16}$/.test(publicBundle.contentVersion)) {
  throw new Error("The public content bundle has an invalid content version.");
}
const config = JSON.parse(await readFile(generatedConfigPath, "utf8"));
config.name = "anish-shah-work-in-public";
config.topLevelName = config.name;
config.workers_dev = true;
config.preview_urls = false;
config.d1_databases = [
  {
    binding: "DB",
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: "../../drizzle",
  },
];
config.kv_namespaces = [
  {
    binding: "PUBLICATION_CACHE",
    id: publicationKvId,
  },
];
config.ratelimits = [
  {
    name: "OWNER_RATE_LIMITER",
    namespace_id: "88001001",
    simple: { limit: 30, period: 60 },
  },
  {
    name: "ARTWORK_RATE_LIMITER",
    namespace_id: "88001002",
    simple: { limit: 120, period: 60 },
  },
  {
    name: "PROMOTION_RATE_LIMITER",
    namespace_id: "88001003",
    simple: { limit: 6, period: 60 },
  },
  {
    name: "OAUTH_CALLBACK_RATE_LIMITER",
    namespace_id: "88001004",
    simple: { limit: 20, period: 60 },
  },
];
config.vars = {
  AUTH_MODE: "cloudflare_access",
  CF_ACCESS_AUD: audiences.join(","),
  CF_ACCESS_TEAM_DOMAIN: accessTeamDomain(required("CF_ACCESS_TEAM_DOMAIN")),
  NODE_ENV: "production",
  OWNER_EMAILS: [...new Set(ownerEmails)].join(","),
  PRODUCTION_SITE_URL: publicSiteUrl,
  SITE_URL: publicSiteUrl,
  STEAM_DATA_STORAGE_COUNTRIES: "United States",
  RELEASE_SHA: releaseSha,
  CONTENT_VERSION: publicBundle.contentVersion,
  PUBLIC_CONTENT_MODE: "d1_kv_required",
};
config.observability = {
  enabled: true,
  head_sampling_rate: 0.1,
  logs: { enabled: true, invocation_logs: false },
};
config.triggers = { crons: ["17 * * * *"] };

await writeFile(releaseConfigPath, `${JSON.stringify(config, null, 2)}\n`, {
  mode: 0o600,
});
console.log("Prepared dist/server/wrangler.public.json without runtime secrets.");
console.log("Set Cloudflare secrets separately, migrate D1, then deploy this exact build.");
