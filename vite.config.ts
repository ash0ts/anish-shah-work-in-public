import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const LOCAL_SERVER_VARIABLE_NAMES = [
  "OWNER_EMAILS",
  "LOCAL_OWNER_EMAIL",
  "CONNECTOR_ENCRYPTION_KEY",
  "RATE_LIMIT_SALT",
  "STEAM_DATA_STORAGE_COUNTRIES",
  "SITE_URL",
  "PRODUCTION_SITE_URL",
  "DEPLOYMENT_TIER",
  "PREVIEW_PR_NUMBER",
  "RELEASE_VERSION",
  "TRAVEL_ATLAS_MODE",
  "PUBLIC_CONTENT_MODE",
  "SIMULATION_EXPERIENCE_MODE",
  "SIMULATION_AI_MODE",
  "SIMULATION_AI_TRANSPORT",
  "SIMULATION_PROVIDER",
  "SIMULATION_MODEL",
  "SIMULATION_SESSION_HMAC_KEY",
  "SIMULATION_GATEWAY_ACCOUNT_ID",
  "SIMULATION_GATEWAY_ID",
  "SIMULATION_GATEWAY_TOKEN",
  "SIMULATION_GATEWAY_BYOK_ALIAS",
  "SIMULATION_LOCAL_ANTHROPIC_API_KEY",
  "SIMULATION_DAILY_MODEL_LIMIT",
] as const;

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  // Wrangler otherwise imports every key from `.env.local` into the Worker and
  // can override the strict binding list below. Keep local Worker secrets on
  // the same explicit allowlist as local identity and configuration.
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  // The Cloudflare RSC runtime does not inherit Vite's process environment.
  // During `vite serve` only, copy a strict allowlist from ignored local env
  // files into local Worker bindings. Production builds receive no local
  // identity or secret bindings from this path.
  const localEnvironment =
    command === "serve" ? loadEnv(mode, process.cwd(), "") : {};
  const localVars =
    command === "serve"
      ? Object.fromEntries([
          ["NODE_ENV", "development"],
          ...LOCAL_SERVER_VARIABLE_NAMES.flatMap((name) => {
            // Explicit command-line values take precedence over ignored env
            // files. This is used by the local live-model wrapper to inject an
            // ephemeral provider key without writing it to disk.
            const value = (
              process.env[name] ?? localEnvironment[name]
            )?.trim();
            return value ? [[name, value] as const] : [];
          }),
        ])
      : {};

  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    vars: localVars,
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: [
      ...(r2
        ? [
            {
              binding: r2,
              bucket_name: "site-creator-r2",
            },
          ]
        : []),
      ...(command === "serve"
        ? [
            {
              binding: "TRAVEL_MEDIA",
              bucket_name: "anish-shah-travel-media-local",
            },
          ]
        : []),
    ],
    ...(command === "serve" ? { images: { binding: "IMAGES" } } : {}),
  };

  return {
    server: {
      host: "localhost",
      port: 3000,
      strictPort: true,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
