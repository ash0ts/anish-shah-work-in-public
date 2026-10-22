import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const { reconcileStalePublicRecords } = await import(
  "../lib/server/public-record-reconciliation.ts"
);
const {
  assertUniquePublicRecordSeedKeys,
  bulkUpsertPublicRecordSeeds,
  canonicalItemSeedSlug,
  isCurrentPublicRecordSeedMetadata,
  PUBLIC_RECORD_SEED_STATEMENT_BUDGET,
  PUBLIC_RECORD_SEED_VERSION,
} = await import("../lib/server/public-record-seed-bulk.ts");

const publicBundle = JSON.parse(
  await readFile(
    new URL("../content/public/anish-content.public.v1.json", import.meta.url),
    "utf8",
  ),
);

class SeedStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    this.database.maximumBoundParameters = Math.max(
      this.database.maximumBoundParameters,
      values.length,
    );
    if (values.length > 100) {
      throw new Error(`D1 bound-parameter limit exceeded: ${values.length}`);
    }
    return this;
  }

  first() {
    return null;
  }

  all() {
    if (this.sql === "SELECT id FROM public_records") {
      return {
        success: true,
        results: [...this.database.records.keys()].map((id) => ({ id })),
        meta: {},
      };
    }
    return { success: true, results: [], meta: {} };
  }

  run() {
    return this.database.run(this);
  }
}

class SeedD1 {
  constructor(staleCount) {
    this.maximumBoundParameters = 0;
    this.runCount = 0;
    this.records = new Map(
      Array.from({ length: staleCount }, (_, index) => [
        `obsolete:${String(index).padStart(3, "0")}`,
        { publicationState: "public", slug: `obsolete-${index}` },
      ]),
    );
  }

  prepare(sql) {
    return new SeedStatement(this, sql);
  }

  async run(statement) {
    const { sql, values } = statement;
    this.runCount += 1;
    let changes = 0;
    if (sql.startsWith("UPDATE public_records") && sql.includes("json_each")) {
      const currentIds = new Set(JSON.parse(values[1]));
      for (const [id, record] of this.records) {
        if (!currentIds.has(id)) {
          record.publicationState = "review_required";
          record.slug = null;
          changes += 1;
        }
      }
    }
    return { success: true, results: [], meta: { changes } };
  }
}

test("public-record reconciliation is one set-based D1 query", async () => {
  const database = new SeedD1(10_000);
  database.records.set("current:one", {
    publicationState: "public",
    slug: "current-one",
  });
  const reconciled = await reconcileStalePublicRecords(
    database,
    new Set(["current:one"]),
    new Date().toISOString(),
  );

  assert.equal(reconciled, 10_000);
  assert.equal(database.maximumBoundParameters, 2);
  assert.equal(database.runCount, 1);
  assert.equal(database.records.get("current:one")?.publicationState, "public");
  assert.equal(database.records.get("current:one")?.slug, "current-one");
  for (let index = 0; index < 10_000; index += 1) {
    assert.equal(
      database.records.get(`obsolete:${String(index).padStart(3, "0")}`)
        ?.publicationState,
      "review_required",
    );
    assert.equal(
      database.records.get(`obsolete:${String(index).padStart(3, "0")}`)?.slug,
      null,
    );
  }
});

function seedRecord(id, slug, overrides = {}) {
  return {
    id,
    recordType: "article",
    slug,
    title: `Title ${id}`,
    summary: "Public summary",
    approvedPublicWording: "Seed wording",
    caveat: "Seed caveat",
    publicPayloadJson: JSON.stringify({ note: "x".repeat(1_024) }),
    publicationState: "public",
    verificationState: "verified",
    evidenceAccess: "public_web",
    featured: false,
    sortOrder: 0,
    ...overrides,
  };
}

class BulkStatement {
  constructor(sql) {
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }
}

class QueryBudgetD1 {
  constructor() {
    this.queryCount = 0;
    this.batches = [];
  }

  prepare(sql) {
    return new BulkStatement(sql);
  }

  async batch(statements) {
    this.queryCount += statements.length;
    if (this.queryCount > 50) {
      throw new Error("D1 free-tier query budget exceeded");
    }
    this.batches.push(statements);
    return statements.map(() => ({ success: true, results: [], meta: {} }));
  }
}

class SqliteD1 extends QueryBudgetD1 {
  constructor() {
    super();
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(`
      CREATE TABLE public_records (
        id TEXT PRIMARY KEY NOT NULL,
        record_type TEXT NOT NULL,
        slug TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        approved_public_wording TEXT NOT NULL,
        public_caveat TEXT NOT NULL,
        public_payload_json TEXT NOT NULL,
        publication_state TEXT NOT NULL,
        verification_state TEXT NOT NULL,
        evidence_access TEXT NOT NULL,
        featured INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX public_records_slug_unique
        ON public_records (slug) WHERE slug IS NOT NULL;
    `);
  }

  insert(record) {
    this.sqlite
      .prepare(`
        INSERT INTO public_records (
          id, record_type, slug, title, summary, approved_public_wording,
          public_caveat, public_payload_json, publication_state,
          verification_state, evidence_access, featured, sort_order, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.recordType,
        record.slug,
        record.title,
        record.summary,
        record.approvedPublicWording,
        record.caveat,
        record.publicPayloadJson,
        record.publicationState,
        record.verificationState,
        record.evidenceAccess,
        record.featured ? 1 : 0,
        record.sortOrder,
        "2025-01-01T00:00:00.000Z",
      );
  }

  row(id) {
    return this.sqlite
      .prepare("SELECT * FROM public_records WHERE id = ?")
      .get(id);
  }

  async batch(statements) {
    this.queryCount += statements.length;
    if (this.queryCount > 50) {
      throw new Error("D1 free-tier query budget exceeded");
    }
    this.batches.push(statements);
    this.sqlite.exec("BEGIN");
    try {
      for (const statement of statements) {
        this.sqlite.prepare(statement.sql).run(...statement.values);
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    return statements.map(() => ({ success: true, results: [], meta: {} }));
  }
}

test("canonical editorial slugs belong to WorkGroups, not their nested forms", () => {
  const nestedItemIds = new Set(
    publicBundle.workGroups.flatMap((group) => group.itemIds),
  );
  const workGroupSlugs = new Set(
    publicBundle.workGroups.map((group) => group.slug),
  );
  const originalCollisions = publicBundle.items.filter((item) =>
    workGroupSlugs.has(item.slug),
  );
  const records = [
    ...publicBundle.items.map((item) => ({
      id: item.id,
      slug: canonicalItemSeedSlug(item.id, item.slug, nestedItemIds),
    })),
    ...publicBundle.metrics.map((metric) => ({ id: metric.id, slug: null })),
    ...publicBundle.narratives.map((narrative) => ({
      id: narrative.id,
      slug: null,
    })),
    ...publicBundle.workGroups.map((group) => ({
      id: group.id,
      slug: group.slug,
    })),
  ];

  assert.equal(publicBundle.items.length, 202);
  assert.equal(publicBundle.workGroups.length, 88);
  assert.equal(nestedItemIds.size, 173);
  assert.equal(originalCollisions.length, 69);
  assert.equal(
    records.slice(0, publicBundle.items.length).filter(({ slug }) => slug === null)
      .length,
    173,
  );
  const expectedRecordCount =
    publicBundle.items.length +
    publicBundle.metrics.length +
    publicBundle.narratives.length +
    publicBundle.workGroups.length;
  assert.equal(records.length, expectedRecordCount);
  assert.doesNotThrow(() => assertUniquePublicRecordSeedKeys(records));
});

test("seed metadata invalidates an older projection algorithm", () => {
  const contentVersion = publicBundle.contentVersion;
  const recordCount =
    publicBundle.items.length +
    publicBundle.metrics.length +
    publicBundle.narratives.length +
    publicBundle.workGroups.length;
  assert.equal(
    isCurrentPublicRecordSeedMetadata(
      { contentVersion, recordCount },
      contentVersion,
      recordCount,
    ),
    false,
  );
  assert.equal(
    isCurrentPublicRecordSeedMetadata(
      {
        seedVersion: PUBLIC_RECORD_SEED_VERSION - 1,
        contentVersion,
        recordCount,
      },
      contentVersion,
      recordCount,
    ),
    false,
  );
  assert.equal(
    isCurrentPublicRecordSeedMetadata(
      {
        seedVersion: PUBLIC_RECORD_SEED_VERSION,
        contentVersion,
        recordCount,
      },
      contentVersion,
      recordCount,
    ),
    true,
  );
  assert.equal(
    isCurrentPublicRecordSeedMetadata(
      {
        seedVersion: PUBLIC_RECORD_SEED_VERSION,
        contentVersion,
        recordCount: recordCount - 1,
      },
      contentVersion,
      recordCount,
    ),
    false,
  );
});

test("bulk public-record seeding remains below the D1 free-tier query ceiling", async () => {
  const database = new QueryBudgetD1();
  const records = Array.from({ length: 287 }, (_, index) =>
    seedRecord(`record:${index}`, `record-${index}`),
  );
  const result = await bulkUpsertPublicRecordSeeds(
    database,
    records,
    "2026-08-03T00:00:00.000Z",
  );

  assert.equal(database.batches.length, 1);
  assert(result.statementCount < 16);
  assert(database.queryCount < 50);
  const upserts = database.batches[0].filter((statement) =>
    statement.sql.startsWith("INSERT INTO public_records"),
  );
  const written = upserts.flatMap((statement) =>
    JSON.parse(statement.values[1]),
  );
  assert.equal(written.length, 287);
  assert.match(upserts[0].sql, /FROM json_each\(\?\) AS entry WHERE 1/);
  const conflictUpdate = upserts[0].sql.split("ON CONFLICT(id) DO UPDATE SET")[1];
  assert.match(conflictUpdate, /slug = excluded\.slug/);
  assert.doesNotMatch(conflictUpdate, /approved_public_wording\s*=/);
  assert.doesNotMatch(conflictUpdate, /publication_state\s*=/);
  assert.doesNotMatch(conflictUpdate, /featured\s*=/);
  assert.doesNotMatch(conflictUpdate, /sort_order\s*=/);
});

test("the complete bootstrap and publication path has a fixed D1 query budget", () => {
  const seedMetadataRead = 1;
  const staleReconciliation = 1;
  const seedMarkerAndAudit = 2;
  const publicationRead = 1;
  const publicationTransaction = 4;
  const maintenanceSuccessOrRecovery = 2;
  const worstCase =
    seedMetadataRead +
    PUBLIC_RECORD_SEED_STATEMENT_BUDGET +
    staleReconciliation +
    seedMarkerAndAudit +
    publicationRead +
    publicationTransaction +
    maintenanceSuccessOrRecovery;

  assert.equal(worstCase, 27);
  assert(worstCase < 50);
});

test("bulk seeding transfers a canonical slug without overwriting editorial choices", async () => {
  const database = new SqliteD1();
  database.insert(
    seedRecord("item:legacy", "canonical-story", {
      approvedPublicWording: "Owner wording",
      caveat: "Owner caveat",
      publicationState: "review_required",
      featured: true,
      sortOrder: 77,
    }),
  );
  database.insert(seedRecord("item:stale-owner", "second-story"));

  await bulkUpsertPublicRecordSeeds(
    database,
    [
      seedRecord("item:legacy", null, {
        approvedPublicWording: "Seed replacement",
        caveat: "Seed replacement caveat",
      }),
      seedRecord("group:canonical", "canonical-story", {
        recordType: "work_group",
      }),
      seedRecord("group:second", "second-story", {
        recordType: "work_group",
      }),
    ],
    "2026-08-03T00:00:00.000Z",
  );

  const nestedItem = database.row("item:legacy");
  assert.equal(nestedItem.slug, null);
  assert.equal(nestedItem.approved_public_wording, "Owner wording");
  assert.equal(nestedItem.public_caveat, "Owner caveat");
  assert.equal(nestedItem.publication_state, "review_required");
  assert.equal(nestedItem.featured, 1);
  assert.equal(nestedItem.sort_order, 77);
  assert.equal(database.row("group:canonical").slug, "canonical-story");
  assert.equal(database.row("group:second").slug, "second-story");
  assert.equal(database.row("item:stale-owner").slug, null);
  assert(database.queryCount < 50);
});

test("duplicate canonical seed slugs fail before any D1 write", async () => {
  const database = new QueryBudgetD1();
  await assert.rejects(
    bulkUpsertPublicRecordSeeds(
      database,
      [seedRecord("one", "shared"), seedRecord("two", "shared")],
      "2026-08-03T00:00:00.000Z",
    ),
    /multiple owners/,
  );
  assert.equal(database.queryCount, 0);
});
