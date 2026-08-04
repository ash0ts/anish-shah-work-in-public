import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDoctorReport,
  formatSetupResult,
  parseEnvironmentFile,
  setupLocalEnvironment,
} from "../scripts/lib/local-dx.mjs";

const fixedRandom = (byte) => () => Buffer.alloc(32, byte);

async function temporaryRoot() {
  return await mkdtemp(path.join(os.tmpdir(), "anish-local-dx-"));
}

function environmentTemplate(overrides = {}) {
  const values = {
    OWNER_EMAILS: "owner@test.local",
    LOCAL_OWNER_EMAIL: "owner@test.local",
    CONNECTOR_ENCRYPTION_KEY: "",
    RATE_LIMIT_SALT: "",
    SIMULATION_SESSION_HMAC_KEY: "",
    STEAM_DATA_STORAGE_COUNTRIES: "United States",
    SITE_URL: "http://localhost:3000",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    ...overrides,
  };
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

async function writeDoctorFixture(root, options = {}) {
  const secretA = Buffer.alloc(32, 17).toString("base64");
  const secretB = Buffer.alloc(32, 29).toString("base64");
  const secretC = Buffer.alloc(32, 37).toString("base64");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      engines: { node: "24.18.x" },
      packageManager: "npm@11.6.2",
      scripts: {
        dev: "vinext dev",
      },
    }),
  );
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await writeFile(path.join(root, "node_modules/.package-lock.json"), "{}\n");
  await mkdir(path.join(root, "drizzle/meta"), { recursive: true });
  await writeFile(path.join(root, "drizzle/0000_first.sql"), "select 1;\n");
  await writeFile(
    path.join(root, "drizzle/meta/_journal.json"),
    JSON.stringify({ entries: [{ idx: 0, tag: "0000_first" }] }),
  );
  await writeFile(
    path.join(root, ".env.local"),
    environmentTemplate({
      CONNECTOR_ENCRYPTION_KEY: secretA,
      RATE_LIMIT_SALT: secretB,
      SIMULATION_SESSION_HMAC_KEY: secretC,
      ...(options.environment ?? {}),
    }),
    { mode: options.mode ?? 0o600 },
  );
  if (options.d1 !== false) {
    await mkdir(path.join(root, ".wrangler/state/v3/d1"), { recursive: true });
    await writeFile(path.join(root, ".wrangler/state/v3/d1/local.sqlite"), "");
  }
  const home = path.join(root, "home");
  if (options.browser !== false) {
    await mkdir(path.join(home, "Applications/Safari.app"), { recursive: true });
  }
  return { home, secretA, secretB, secretC };
}

test("setup:local creates an owner-only file and fills only missing secrets", async () => {
  const root = await temporaryRoot();
  await writeFile(path.join(root, ".env.example"), environmentTemplate());

  const result = await setupLocalEnvironment({
    root,
    environment: {},
    random: fixedRandom(9),
  });
  const environmentPath = path.join(root, ".env.local");
  const content = await readFile(environmentPath, "utf8");
  const parsed = parseEnvironmentFile(content);
  const metadata = await stat(environmentPath);

  assert.equal(result.created, true);
  assert.deepEqual(result.generated, [
    "CONNECTOR_ENCRYPTION_KEY",
    "RATE_LIMIT_SALT",
    "SIMULATION_SESSION_HMAC_KEY",
  ]);
  assert.equal(parsed.values.get("CONNECTOR_ENCRYPTION_KEY"), Buffer.alloc(32, 9).toString("base64"));
  assert.equal(parsed.values.get("RATE_LIMIT_SALT"), Buffer.alloc(32, 9).toString("base64"));
  assert.equal(
    parsed.values.get("SIMULATION_SESSION_HMAC_KEY"),
    Buffer.alloc(32, 9).toString("base64"),
  );
  assert.equal(metadata.mode & 0o777, 0o600);
});

test("setup:local preserves configured values and repairs permissions without generating", async () => {
  const root = await temporaryRoot();
  const first = Buffer.alloc(32, 3).toString("base64");
  const second = Buffer.alloc(32, 4).toString("base64");
  const third = Buffer.alloc(32, 5).toString("base64");
  const source = environmentTemplate({
    CONNECTOR_ENCRYPTION_KEY: first,
    RATE_LIMIT_SALT: second,
    SIMULATION_SESSION_HMAC_KEY: third,
  });
  await writeFile(path.join(root, ".env.example"), environmentTemplate());
  await writeFile(path.join(root, ".env.local"), source, { mode: 0o644 });

  const result = await setupLocalEnvironment({
    root,
    environment: {},
    random: () => {
      throw new Error("random generation must not run");
    },
  });

  assert.deepEqual(result.generated, []);
  assert.equal(await readFile(path.join(root, ".env.local"), "utf8"), source);
  assert.equal((await stat(path.join(root, ".env.local"))).mode & 0o777, 0o600);
});

test("setup:local fills one missing secret without replacing the configured peer", async () => {
  const root = await temporaryRoot();
  const existing = Buffer.alloc(32, 41).toString("base64");
  const existingSimulation = Buffer.alloc(32, 42).toString("base64");
  await writeFile(path.join(root, ".env.example"), environmentTemplate());
  await writeFile(
    path.join(root, ".env.local"),
    environmentTemplate({
      CONNECTOR_ENCRYPTION_KEY: existing,
      SIMULATION_SESSION_HMAC_KEY: existingSimulation,
    }),
    { mode: 0o600 },
  );
  let calls = 0;
  const result = await setupLocalEnvironment({
    root,
    environment: {},
    random: (size) => {
      calls += 1;
      return Buffer.alloc(size, 52);
    },
  });
  const parsed = parseEnvironmentFile(
    await readFile(path.join(root, ".env.local"), "utf8"),
  );

  assert.deepEqual(result.generated, ["RATE_LIMIT_SALT"]);
  assert.equal(calls, 1);
  assert.equal(parsed.values.get("CONNECTOR_ENCRYPTION_KEY"), existing);
  assert.equal(
    parsed.values.get("SIMULATION_SESSION_HMAC_KEY"),
    existingSimulation,
  );
  assert.equal(
    parsed.values.get("RATE_LIMIT_SALT"),
    Buffer.alloc(32, 52).toString("base64"),
  );
  const output = formatSetupResult(result);
  assert.equal(output.includes(existing), false);
  assert.equal(output.includes(parsed.values.get("RATE_LIMIT_SALT")), false);
  assert.match(output, /Generated 1 missing local-only security value/);
});

test("setup:local fails closed in CI and hosted configurations", async () => {
  const root = await temporaryRoot();
  await writeFile(path.join(root, ".env.example"), environmentTemplate());

  await assert.rejects(
    setupLocalEnvironment({ root, environment: { CI: "true" } }),
    /disabled when hosted or CI configuration is present/,
  );
  await assert.rejects(
    setupLocalEnvironment({
      root,
      environment: { SITE_URL: "https://staging.anish-shah-is.online" },
    }),
    /SITE_URL must be an exact loopback/,
  );
  await assert.rejects(
    setupLocalEnvironment({
      root,
      environment: {
        PRODUCTION_SITE_URL: "https://staging.anish-shah-is.online",
      },
    }),
    /PRODUCTION_SITE_URL must match the canonical production origin/,
  );
  await assert.rejects(
    setupLocalEnvironment({
      root,
      environment: { AUTH_MODE: "cloudflare_access" },
    }),
    /disabled for a hosted runtime/,
  );
  await assert.rejects(stat(path.join(root, ".env.local")), /ENOENT/);
});

test("setup:local rejects duplicate keys, hosted files, and symlink targets", async () => {
  const duplicateRoot = await temporaryRoot();
  await writeFile(
    path.join(duplicateRoot, ".env.local"),
    `${environmentTemplate()}RATE_LIMIT_SALT=duplicate\n`,
  );
  await assert.rejects(
    setupLocalEnvironment({ root: duplicateRoot, environment: {} }),
    /Duplicate RATE_LIMIT_SALT/,
  );

  const hostedRoot = await temporaryRoot();
  await writeFile(
    path.join(hostedRoot, ".env.local"),
    environmentTemplate({ SITE_URL: "https://example.com" }),
  );
  await assert.rejects(
    setupLocalEnvironment({ root: hostedRoot, environment: {} }),
    /must be an exact loopback/,
  );

  const redirectedProductionRoot = await temporaryRoot();
  await writeFile(
    path.join(redirectedProductionRoot, ".env.local"),
    environmentTemplate({
      PRODUCTION_SITE_URL: "https://staging.anish-shah-is.online",
    }),
  );
  await assert.rejects(
    setupLocalEnvironment({
      root: redirectedProductionRoot,
      environment: {},
    }),
    /PRODUCTION_SITE_URL must match the canonical production origin/,
  );

  const symlinkRoot = await temporaryRoot();
  await writeFile(path.join(symlinkRoot, "target"), environmentTemplate());
  await symlink(path.join(symlinkRoot, "target"), path.join(symlinkRoot, ".env.local"));
  await assert.rejects(
    setupLocalEnvironment({ root: symlinkRoot, environment: {} }),
    /regular file with exactly one link/,
  );

  const hardlinkRoot = await temporaryRoot();
  await writeFile(path.join(hardlinkRoot, "target"), environmentTemplate());
  await link(path.join(hardlinkRoot, "target"), path.join(hardlinkRoot, ".env.local"));
  await assert.rejects(
    setupLocalEnvironment({ root: hardlinkRoot, environment: {} }),
    /regular file with exactly one link/,
  );
});

test("doctor reports a ready local environment without exposing values", async () => {
  const root = await temporaryRoot();
  const fixture = await writeDoctorFixture(root);
  const report = await createDoctorReport({
    root,
    environment: {},
    command: () => ({ status: 0, stdout: "11.6.2\n" }),
    homeDirectory: fixture.home,
    checkBrowser: async () => true,
    checkManualBrowser: async () => true,
    checkPort: async () => true,
    nodeVersion: "v24.18.0",
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.ok, true);
  assert.equal(report.checks.every((entry) => entry.status === "pass"), true);
  assert.equal(serialized.includes(fixture.secretA), false);
  assert.equal(serialized.includes(fixture.secretB), false);
  assert.equal(serialized.includes(fixture.secretC), false);
  assert.equal(serialized.includes("owner@test.local"), false);
});

test("doctor treats missing optional runtime state as warnings but unsafe config as failure", async () => {
  const warningRoot = await temporaryRoot();
  const warningFixture = await writeDoctorFixture(warningRoot, {
    browser: false,
    d1: false,
  });
  const warningReport = await createDoctorReport({
    root: warningRoot,
    environment: {},
    command: () => ({ status: 0, stdout: "11.6.2\n" }),
    homeDirectory: warningFixture.home,
    checkBrowser: async () => false,
    checkManualBrowser: async () => false,
    checkPort: async () => false,
    nodeVersion: "v24.18.0",
  });
  assert.equal(warningReport.ok, true);
  assert.equal(
    warningReport.checks.filter((entry) => entry.status === "warn").length,
    5,
  );

  const unsafeRoot = await temporaryRoot();
  const unsafeFixture = await writeDoctorFixture(unsafeRoot);
  await chmod(path.join(unsafeRoot, ".env.local"), 0o644);
  const unsafeReport = await createDoctorReport({
    root: unsafeRoot,
    environment: {},
    command: () => ({ status: 0, stdout: "11.6.2\n" }),
    homeDirectory: unsafeFixture.home,
    checkBrowser: async () => true,
    checkManualBrowser: async () => true,
    checkPort: async () => true,
    nodeVersion: "v24.18.0",
  });
  assert.equal(unsafeReport.ok, false);
  assert.equal(
    unsafeReport.checks.some(
      (entry) => entry.id === "environment-permissions" && entry.status === "fail",
    ),
    true,
  );
});

test("doctor fails closed when the inherited shell looks hosted", async () => {
  const root = await temporaryRoot();
  const fixture = await writeDoctorFixture(root);
  const report = await createDoctorReport({
    root,
    environment: { DEPLOYMENT_TIER: "production" },
    command: () => ({ status: 0, stdout: "11.6.2\n" }),
    homeDirectory: fixture.home,
    checkBrowser: async () => true,
    checkManualBrowser: async () => true,
    checkPort: async () => true,
    nodeVersion: "v24.18.0",
  });
  assert.equal(report.ok, false);
  assert.equal(
    report.checks.some(
      (entry) =>
        entry.id === "process-environment" && entry.status === "fail",
    ),
    true,
  );
  assert.equal(JSON.stringify(report).includes("production"), false);
});

test("doctor rejects an inherited production-origin override", async () => {
  const root = await temporaryRoot();
  const fixture = await writeDoctorFixture(root);
  const report = await createDoctorReport({
    root,
    environment: {
      PRODUCTION_SITE_URL: "https://staging.anish-shah-is.online",
    },
    command: () => ({ status: 0, stdout: "11.6.2\n" }),
    homeDirectory: fixture.home,
    checkBrowser: async () => true,
    checkManualBrowser: async () => true,
    checkPort: async () => true,
    nodeVersion: "v24.18.0",
  });

  assert.equal(report.ok, false);
  assert.equal(
    report.checks.some(
      (entry) =>
        entry.id === "process-environment" && entry.status === "fail",
    ),
    true,
  );
  assert.equal(
    JSON.stringify(report).includes("staging.anish-shah-is.online"),
    false,
  );
});
