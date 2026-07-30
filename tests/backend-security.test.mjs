import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  decryptCredential,
  encryptCredential,
} from "../lib/server/credential-crypto.ts";
import {
  evaluateOwnerAuthorization,
  parseOwnerEmails,
} from "../lib/server/owner-policy.ts";
import {
  validateEditorialPatch,
  validatePublicProjection,
} from "../lib/server/editorial-policy.ts";

const root = new URL("../", import.meta.url);

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
  const [initialMigration, editorialMigration, hosting] = await Promise.all([
    readFile(
      new URL("../drizzle/0000_jittery_whistler.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0001_gifted_frog_thor.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  const migration = `${initialMigration}\n${editorialMigration}`;

  for (const table of [
    "public_records",
    "editorial_settings",
    "connector_credentials",
    "connector_snapshots",
    "sync_runs",
    "audit_log",
    "publication_snapshots",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \\\`${table}\\\``));
  }
  assert.match(migration, /`ciphertext` text NOT NULL/);
  assert.match(migration, /`iv` text NOT NULL/);
  assert.match(migration, /`approved_public_wording` text/);
  assert.match(migration, /`public_caveat` text/);
  assert.doesNotMatch(migration, /access_token|refresh_token|api_token/i);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.equal(JSON.parse(hosting).r2, null);
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
