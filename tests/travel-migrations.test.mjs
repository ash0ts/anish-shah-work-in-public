import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = path.join(root, "drizzle");
const travelTables = [
  "travel_media_deletions",
  "travel_photo_tags",
  "travel_photos",
  "travel_places",
  "travel_publication_snapshots",
  "travel_publication_state",
  "travel_trips",
  "travel_uploads",
];

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

function tableNames(database) {
  return database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);
}

function assertHealthy(database) {
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
}

test("0007 has coherent Drizzle lineage and introduces only Travel state", async () => {
  const [journal, previous, current] = await Promise.all([
    readFile(path.join(migrationDirectory, "meta/_journal.json"), "utf8").then(JSON.parse),
    readFile(path.join(migrationDirectory, "meta/0006_snapshot.json"), "utf8").then(JSON.parse),
    readFile(path.join(migrationDirectory, "meta/0007_snapshot.json"), "utf8").then(JSON.parse),
  ]);

  assert.deepEqual(journal.entries[7], {
    idx: 7,
    version: "6",
    when: journal.entries[7].when,
    tag: "0007_travel_atlas",
    breakpoints: true,
  });
  assert.equal(current.prevId, previous.id);
  assert.deepEqual(
    Object.keys(current.tables)
      .filter((name) => !Object.hasOwn(previous.tables, name))
      .sort(),
    travelTables,
  );
});

test("the complete migration chain builds a healthy clean database", async () => {
  const migrations = await orderedMigrations();
  assert.equal(migrations[6], "0006_public_model_simulation.sql");
  assert.equal(migrations[7], "0007_travel_atlas.sql");

  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    await apply(database, migrations);
    assert.deepEqual(
      tableNames(database).filter((name) => name.startsWith("travel_")),
      travelTables,
    );
    assert.deepEqual(
      { ...database.prepare("SELECT key, status, details_json FROM maintenance_state WHERE key = ?").get("travel.cleanup") },
      {
        key: "travel.cleanup",
        status: "ready",
        details_json: '{"removedUploads":0,"removedSnapshots":0,"removedMedia":0}',
      },
    );
    assertHealthy(database);
  } finally {
    database.close();
  }
});

test("0006 and 0007 upgrade a populated 0005 database without rewriting existing state", async () => {
  const migrations = await orderedMigrations();
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

    await apply(database, migrations.slice(6));

    assert.equal(
      database.prepare("SELECT details_json FROM maintenance_state WHERE key = ?").get("retention").details_json,
      '{"source":"upgrade-fixture"}',
    );
    assert.equal(
      database.prepare("SELECT credential_label FROM connector_credentials WHERE provider = ?").get("fixture").credential_label,
      "Upgrade fixture",
    );
    database
      .prepare(
        "INSERT INTO simulation_sessions (session_hash, campaign_version, safe_state_json, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run("upgrade-session", "campaign-v1", "{}", "2026-08-04T14:00:00.000Z");
    database
      .prepare(
        "INSERT INTO travel_trips (id, slug, title, summary, status, period_start, period_precision, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "trip_upgrade_fixture",
        "upgrade-fixture",
        "Upgrade fixture",
        "A migration fixture.",
        "completed",
        "2026-08-01",
        "day",
        "revision-1",
      );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM travel_trips").get().count, 1);
    assertHealthy(database);
  } finally {
    database.close();
  }
});
