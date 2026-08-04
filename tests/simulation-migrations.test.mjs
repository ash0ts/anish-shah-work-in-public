import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = path.join(root, "drizzle");

async function orderedMigrations() {
  return (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
}

async function apply(database, migrationNames) {
  for (const name of migrationNames) {
    database.exec(await readFile(path.join(migrationDirectory, name), "utf8"));
  }
}

function schemaNames(database, kind) {
  return database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all(kind)
    .map(({ name }) => name);
}

test("0006 has coherent Drizzle lineage and introduces only Simulation state", async () => {
  const [journal, previous, current] = await Promise.all([
    readFile(path.join(migrationDirectory, "meta/_journal.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(path.join(migrationDirectory, "meta/0005_snapshot.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(path.join(migrationDirectory, "meta/0006_snapshot.json"), "utf8").then(
      JSON.parse,
    ),
  ]);

  assert.deepEqual(journal.entries[6], {
    idx: 6,
    version: "6",
    when: journal.entries[6].when,
    tag: "0006_public_model_simulation",
    breakpoints: true,
  });
  assert.equal(current.prevId, previous.id);
  assert.deepEqual(
    Object.keys(current.tables)
      .filter((name) => name.startsWith("simulation_"))
      .sort(),
    [
      "simulation_daily_budget",
      "simulation_provider_approvals",
      "simulation_sessions",
    ],
  );
  assert.deepEqual(
    Object.keys(current.tables)
      .filter((name) => !Object.hasOwn(previous.tables, name))
      .sort(),
    [
      "simulation_daily_budget",
      "simulation_provider_approvals",
      "simulation_sessions",
    ],
  );
});

test("0006 upgrades a populated 0005 database without changing existing state", async () => {
  const migrations = await orderedMigrations();
  assert.equal(migrations[6], "0006_public_model_simulation.sql");

  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    await apply(database, migrations.slice(0, 6));
    database
      .prepare(
        "INSERT INTO maintenance_state (key, status, details_json, checked_at) VALUES (?, ?, ?, ?)",
      )
      .run("retention", "healthy", '{"source":"upgrade-fixture"}', "2026-08-04T12:00:00.000Z");
    database
      .prepare(
        "INSERT INTO connector_credentials (provider, ciphertext, iv, credential_label) VALUES (?, ?, ?, ?)",
      )
      .run("fixture", "ciphertext", "iv", "Upgrade fixture");

    const tablesBefore = schemaNames(database, "table");
    await apply(database, [migrations[6]]);
    const tablesAfter = schemaNames(database, "table");

    assert.deepEqual(
      tablesAfter.filter((name) => !tablesBefore.includes(name)),
      [
        "simulation_daily_budget",
        "simulation_provider_approvals",
        "simulation_sessions",
      ],
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            "SELECT key, status, details_json, checked_at FROM maintenance_state WHERE key = ?",
          )
          .get("retention"),
      },
      {
        key: "retention",
        status: "healthy",
        details_json: '{"source":"upgrade-fixture"}',
        checked_at: "2026-08-04T12:00:00.000Z",
      },
    );
    assert.equal(
      database
        .prepare("SELECT credential_label FROM connector_credentials WHERE provider = ?")
        .get("fixture").credential_label,
      "Upgrade fixture",
    );

    database
      .prepare(
        "INSERT INTO simulation_sessions (session_hash, campaign_version, safe_state_json, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run("session-hash", "campaign-v1", "{}", "2026-08-04T14:00:00.000Z");
    database
      .prepare("INSERT INTO simulation_daily_budget (budget_date) VALUES (?)")
      .run("2026-08-04");
    database
      .prepare(
        "INSERT INTO simulation_provider_approvals (provider, reference, approved_at) VALUES (?, ?, ?)",
      )
      .run("spotify", "owner-review", "2026-08-04T12:00:00.000Z");

    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(
      schemaNames(database, "index").filter((name) => name.startsWith("simulation_")),
      [
        "simulation_provider_approvals_enabled_expiry_idx",
        "simulation_sessions_expiry_idx",
        "simulation_sessions_status_updated_idx",
      ],
    );
  } finally {
    database.close();
  }
});
