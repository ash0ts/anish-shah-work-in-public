import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clean = process.argv.includes("--clean");
const localWranglerDirectory = resolve(projectRoot, ".wrangler");
mkdirSync(localWranglerDirectory, { recursive: true });
const localStateDirectory = clean
  ? mkdtempSync(resolve(localWranglerDirectory, "validation-d1-"))
  : resolve(localWranglerDirectory, "state");
const temporaryConfig = resolve(
  projectRoot,
  `.wrangler/local-d1-${process.pid}.json`,
);
const wranglerEntry = resolve(
  projectRoot,
  "node_modules/wrangler/bin/wrangler.js",
);

const localConfig = {
  $schema: resolve(projectRoot, "node_modules/wrangler/config-schema.json"),
  name: "anish-site-local-d1",
  compatibility_date: "2026-05-15",
  d1_databases: [
    {
      binding: "DB",
      database_name: "site-creator-d1",
      database_id: "00000000-0000-4000-8000-000000000000",
      migrations_dir: resolve(projectRoot, "drizzle"),
    },
  ],
};

mkdirSync(dirname(temporaryConfig), { recursive: true });
writeFileSync(temporaryConfig, `${JSON.stringify(localConfig, null, 2)}\n`, {
  mode: 0o600,
});

try {
  const result = spawnSync(
    process.execPath,
    [
      wranglerEntry,
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      localStateDirectory,
      "--config",
      temporaryConfig,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: resolve(
          projectRoot,
          ".wrangler/local-d1-migrations.log",
        ),
      },
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporaryConfig, { force: true });
  if (clean) rmSync(localStateDirectory, { force: true, recursive: true });
}
