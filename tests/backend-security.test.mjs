import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  decryptCredential,
  encryptCredential,
} from "../lib/server/credential-crypto.ts";
import {
  isLocalDevelopmentRequest,
  localStudioSetupPath,
  resolveLocalDevelopmentUser,
  safeAuthReturnPath,
} from "../app/chatgpt-auth.ts";
import {
  evaluateOwnerAuthorization,
  parseOwnerEmails,
} from "../lib/server/owner-policy.ts";
import {
  validateEditorialPatch,
  validatePublicProjection,
} from "../lib/server/editorial-policy.ts";

const root = new URL("../", import.meta.url);

test("local Studio identity is limited to allowlisted loopback development requests", () => {
  const environment = {
    NODE_ENV: "development",
    LOCAL_OWNER_EMAIL: "Anish@Example.com",
    OWNER_EMAILS: "ops@example.com, anish@example.com",
  };

  for (const host of [
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:8788",
    "[::1]",
    "[::1]:3000",
  ]) {
    assert.deepEqual(
      resolveLocalDevelopmentUser(new Headers({ host }), environment),
      {
        authSource: "local-development",
        displayName: "Anish@Example.com",
        email: "Anish@Example.com",
        fullName: null,
      },
    );
  }
});

test("local Studio identity fails closed outside its exact security boundary", () => {
  const allowedEnvironment = {
    NODE_ENV: "development",
    LOCAL_OWNER_EMAIL: "anish@example.com",
    OWNER_EMAILS: "anish@example.com",
  };

  for (const host of [
    "anish.test",
    "localhost.example.com",
    "127.0.0.2",
    "0.0.0.0",
    "localhost:65536",
    " localhost:3000",
    "localhost:3000 ",
  ]) {
    assert.equal(
      resolveLocalDevelopmentUser(
        { get: (name) => (name.toLowerCase() === "host" ? host : null) },
        allowedEnvironment,
      ),
      null,
      host,
    );
  }

  assert.equal(
    resolveLocalDevelopmentUser(new Headers({ host: "localhost:3000" }), {
      ...allowedEnvironment,
      NODE_ENV: "production",
    }),
    null,
  );
  assert.equal(
    resolveLocalDevelopmentUser(new Headers({ host: "localhost:3000" }), {
      ...allowedEnvironment,
      NODE_ENV: "test",
    }),
    null,
  );
  assert.equal(
    resolveLocalDevelopmentUser(new Headers({ host: "localhost:3000" }), {
      NODE_ENV: "development",
      OWNER_EMAILS: "anish@example.com",
    }),
    null,
  );
  assert.equal(
    resolveLocalDevelopmentUser(new Headers({ host: "localhost:3000" }), {
      ...allowedEnvironment,
      OWNER_EMAILS: "someone-else@example.com",
    }),
    null,
  );
  assert.equal(
    resolveLocalDevelopmentUser(
      new Headers({
        host: "portfolio.example.com",
        "x-forwarded-host": "localhost:3000",
      }),
      allowedEnvironment,
    ),
    null,
  );
});

test("misconfigured loopback Studio gets a diagnostic path without gaining access", () => {
  const loopback = new Headers({ host: "localhost:3000" });
  const missingOwner = {
    NODE_ENV: "development",
    OWNER_EMAILS: "anish@example.com",
  };

  assert.equal(isLocalDevelopmentRequest(loopback, missingOwner), true);
  assert.equal(resolveLocalDevelopmentUser(loopback, missingOwner), null);
  assert.equal(
    localStudioSetupPath("/studio"),
    "/studio/local-setup?return_to=%2Fstudio",
  );
  assert.equal(
    isLocalDevelopmentRequest(loopback, { NODE_ENV: "production" }),
    false,
  );
  assert.equal(
    isLocalDevelopmentRequest(
      new Headers({ host: "portfolio.example.com" }),
      missingOwner,
    ),
    false,
  );
  assert.equal(safeAuthReturnPath("//evil.example/studio"), "/");
  assert.equal(safeAuthReturnPath("/signin-with-chatgpt"), "/");
});

test("owner access is an exact, normalized email allowlist", () => {
  assert.deepEqual(
    parseOwnerEmails(" Anish@Example.com,ops@example.com,anish@example.com "),
    ["anish@example.com", "ops@example.com"],
  );
  assert.deepEqual(
    evaluateOwnerAuthorization("ANISH@example.com", "anish@example.com"),
    { status: "allowed", configured: true },
  );
  assert.deepEqual(
    evaluateOwnerAuthorization("anish+other@example.com", "anish@example.com"),
    { status: "forbidden", configured: true },
  );
  assert.deepEqual(evaluateOwnerAuthorization("anish@example.com", ""), {
    status: "setup_required",
    configured: false,
  });
});

test("connector credentials use authenticated encryption and context binding", async () => {
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64",
  );
  const token = "test-only-token-never-store-in-source";
  const encrypted = await encryptCredential(
    { accessToken: token },
    key,
    "myanimelist",
  );

  assert.equal(encrypted.keyVersion, "v1");
  assert.equal(encrypted.iv.length > 0, true);
  assert.equal(encrypted.ciphertext.includes(token), false);
  assert.deepEqual(
    await decryptCredential(encrypted, key, "myanimelist"),
    { accessToken: token },
  );
  await assert.rejects(
    decryptCredential(encrypted, key, "hardcover"),
    /operation failed|decrypt/i,
  );
});

test("D1 migrations contain the scoped tables and encrypted credential fields", async () => {
  const [
    initialMigration,
    editorialMigration,
    oauthMigration,
    generationMigration,
    maintenanceMigration,
    hosting,
  ] = await Promise.all([
    readFile(
      new URL("../drizzle/0000_jittery_whistler.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0001_gifted_frog_thor.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0002_secure_mal_oauth.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../drizzle/0003_breezy_donald_blake.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../drizzle/0005_steady_publication_guard.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  const migration =
    `${initialMigration}\n${editorialMigration}\n` +
    `${oauthMigration}\n${generationMigration}\n${maintenanceMigration}`;

  for (const table of [
    "public_records",
    "editorial_settings",
    "connector_credentials",
    "connector_oauth_transactions",
    "connector_snapshots",
    "sync_runs",
    "audit_log",
    "publication_snapshots",
    "maintenance_state",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \\\`${table}\\\``));
  }
  assert.match(migration, /`ciphertext` text NOT NULL/);
  assert.match(migration, /`iv` text NOT NULL/);
  assert.match(
    generationMigration,
    /ADD `generation` integer DEFAULT 1 NOT NULL/,
  );
  assert.match(migration, /`approved_public_wording` text/);
  assert.match(migration, /`public_caveat` text/);
  assert.doesNotMatch(migration, /access_token|refresh_token|api_token/i);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.equal(JSON.parse(hosting).r2, null);
});

test("local Studio migrations are pinned to the isolated local D1 sandbox", async () => {
  const migrationScript = await readFile(
    new URL(
      "../scripts/apply-local-d1-migrations.mjs",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migrationScript, /"--local"/);
  assert.match(migrationScript, /localWranglerDirectory/);
  assert.match(migrationScript, /"state"/);
  assert.match(migrationScript, /"--clean"/);
  assert.match(
    migrationScript,
    /00000000-0000-4000-8000-000000000000/,
  );
  assert.doesNotMatch(migrationScript, /"--remote"/);
  assert.doesNotMatch(migrationScript, /appgprj_/);
});

test("editorial policy only accepts narrow plain-text public fields", () => {
  assert.deepEqual(
    validateEditorialPatch({
      featured: true,
      sortOrder: 4,
      approvedPublicWording: "7K+ course enrollments",
      caveat: "Internal analytics, as of July 2026.",
      visibility: "public",
    }),
    {
      ok: true,
      value: {
        featured: true,
        sortOrder: 4,
        approvedPublicWording: "7K+ course enrollments",
        caveat: "Internal analytics, as of July 2026.",
        visibility: "public",
      },
      changedFields: [
        "approvedPublicWording",
        "caveat",
        "featured",
        "sortOrder",
        "visibility",
      ],
    },
  );
  assert.equal(
    validateEditorialPatch({ title: "Replace source title" }).ok,
    false,
  );
  assert.equal(
    validateEditorialPatch({
      approvedPublicWording: "<strong>7,372 exact enrollments</strong>",
    }).ok,
    false,
  );
  assert.equal(
    validateEditorialPatch({
      caveat: "See https://company.slack.com/archives/private",
    }).ok,
    false,
  );
  assert.equal(
    validatePublicProjection({ displayValue: "7K+", publicEvidenceIds: [] }).ok,
    true,
  );
  assert.equal(validatePublicProjection({ value: 7372 }).ok, false);
  assert.equal(
    validatePublicProjection({ sourceRecord: { row: 12 } }).ok,
    false,
  );
});

test("runtime D1 access uses prepared statements and owner-gated writes", async () => {
  const paths = [
    "lib/server/connectors/repository.ts",
    "lib/server/editorial.ts",
    "app/api/connectors/status/route.ts",
    "app/api/connectors/[provider]/route.ts",
    "app/api/connectors/[provider]/refresh/route.ts",
    "app/api/connectors/[provider]/credentials/route.ts",
    "app/api/studio/records/route.ts",
    "app/api/studio/records/[id]/route.ts",
    "app/api/studio/publish/route.ts",
  ];
  const sources = await Promise.all(
    paths.map((path) => readFile(new URL(path, root), "utf8")),
  );
  const joined = sources.join("\n");

  assert.match(joined, /\.prepare\(/);
  assert.doesNotMatch(joined, /\.exec\(/);
  assert.match(joined, /authorizeOwnerApi/);
  assert.match(joined, /rejectCrossOriginWrite/);
  assert.doesNotMatch(joined, /dangerouslySetInnerHTML/);
});
