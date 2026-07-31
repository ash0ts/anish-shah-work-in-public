import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const LOCAL_SERVER_VARIABLE_NAMES = [
  "OWNER_EMAILS",
  "LOCAL_OWNER_EMAIL",
  "CONNECTOR_ENCRYPTION_KEY",
  "MYANIMELIST_PROFILE_URL",
  "HARDCOVER_PROFILE_URL",
  "STEAM_DATA_STORAGE_COUNTRIES",
] as const;

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

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
            const value = localEnvironment[name]?.trim();
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
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
  };

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
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
