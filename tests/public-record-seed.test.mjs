import assert from "node:assert/strict";
import test from "node:test";

const { reconcileStalePublicRecords } = await import(
  "../lib/server/public-record-reconciliation.ts"
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
    this.records = new Map(
      Array.from({ length: staleCount }, (_, index) => [
        `obsolete:${String(index).padStart(3, "0")}`,
        { publicationState: "public" },
      ]),
    );
  }

  prepare(sql) {
    return new SeedStatement(this, sql);
  }

  async run(statement) {
    const { sql, values } = statement;
    if (
      sql.startsWith("UPDATE public_records") &&
      sql.includes("WHERE id IN")
    ) {
      for (const id of values.slice(1)) {
        const record = this.records.get(id);
        if (record) record.publicationState = "review_required";
      }
    }
    return { success: true, results: [], meta: { changes: 1 } };
  }
}

test("public-record reconciliation stays within D1's 100-parameter limit", async () => {
  const database = new SeedD1(205);
  database.records.set("current:one", { publicationState: "public" });
  const reconciled = await reconcileStalePublicRecords(
    database,
    new Set(["current:one"]),
    new Date().toISOString(),
  );

  assert.equal(reconciled, 205);
  assert.equal(database.maximumBoundParameters, 100);
  assert.equal(database.records.get("current:one")?.publicationState, "public");
  for (let index = 0; index < 205; index += 1) {
    assert.equal(
      database.records.get(`obsolete:${String(index).padStart(3, "0")}`)
        ?.publicationState,
      "review_required",
    );
  }
});
