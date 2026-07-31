import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const {
  applyPlayPromotion,
  issuePlayPromotion,
  playPromotionInternals,
  stagePlayPromotion,
} = await import("../lib/server/play-promotion.ts");

class PromotionStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  first() {
    if (this.sql.includes("FROM play_promotion_transactions")) {
      return this.database.rows.get(this.values[0]) ?? null;
    }
    return null;
  }

  run() {
    return this.database.run(this);
  }
}

class PromotionD1 {
  constructor() {
    this.failCompletionBatch = false;
    this.rows = new Map();
  }

  prepare(sql) {
    return new PromotionStatement(this, sql);
  }

  async batch(statements) {
    if (
      this.failCompletionBatch &&
      statements.some((statement) => statement.sql.includes("SET status = 'applied'"))
    ) {
      this.failCompletionBatch = false;
      throw new Error("simulated completion failure");
    }
    const results = [];
    for (const statement of statements) results.push(await this.run(statement));
    return results;
  }

  async run(statement) {
    const sql = statement.sql;
    const values = statement.values;
    let changes = 0;
    if (sql.startsWith("DELETE FROM play_promotion_transactions")) {
      const [cutoff] = values;
      for (const [id, row] of this.rows) {
        if (row.createdAt <= cutoff) {
          this.rows.delete(id);
          changes += 1;
        }
      }
    } else if (sql.startsWith("INSERT INTO play_promotion_transactions")) {
      const [
        id,
        tokenHash,
        ownerEmail,
        targetOrigin,
        expiresAt,
        createdAt,
      ] = values;
      this.rows.set(id, {
        id,
        tokenHash,
        ownerEmail,
        targetOrigin,
        status: "issued",
        attempts: 0,
        ciphertext: null,
        iv: null,
        keyVersion: null,
        providersJson: "[]",
        expiresAt,
        stagedExpiresAt: null,
        createdAt,
      });
      changes = 1;
    } else if (
      sql.startsWith("UPDATE play_promotion_transactions") &&
      sql.includes("attempts = attempts + 1") &&
      !sql.includes("status = 'staged'")
    ) {
      const [, id, limit] = values;
      const row = this.rows.get(id);
      if (row?.status === "issued" && row.attempts < limit) {
        row.attempts += 1;
        changes = 1;
      }
    } else if (
      sql.startsWith("UPDATE play_promotion_transactions") &&
      sql.includes("status = 'staged'") &&
      sql.includes("attempts = attempts + 1")
    ) {
      const [
        ciphertext,
        iv,
        keyVersion,
        providersJson,
        stagedExpiresAt,
        ,
        ,
        id,
        maxAttempts,
        now,
      ] = values;
      const row = this.rows.get(id);
      if (
        row?.status === "issued" &&
        row.attempts < maxAttempts &&
        row.expiresAt > now
      ) {
        Object.assign(row, {
          status: "staged",
          attempts: row.attempts + 1,
          ciphertext,
          iv,
          keyVersion,
          providersJson,
          stagedExpiresAt,
        });
        changes = 1;
      }
    } else if (
      sql.startsWith("UPDATE play_promotion_transactions") &&
      sql.includes("SET status = 'applying'")
    ) {
      const [, id, ownerEmail, now] = values;
      const row = this.rows.get(id);
      if (
        row?.status === "staged" &&
        row.ownerEmail === ownerEmail &&
        row.stagedExpiresAt > now
      ) {
        row.status = "applying";
        changes = 1;
      }
    } else if (
      sql.startsWith("UPDATE play_promotion_transactions") &&
      sql.includes("SET status = 'staged'")
    ) {
      const [, id, ownerEmail, now] = values;
      const row = this.rows.get(id);
      if (
        row?.status === "applying" &&
        row.ownerEmail === ownerEmail &&
        row.stagedExpiresAt > now
      ) {
        row.status = "staged";
        changes = 1;
      }
    } else if (
      sql.startsWith("UPDATE play_promotion_transactions") &&
      sql.includes("SET status = 'expired'")
    ) {
      const [, id, ownerEmail, now] = values;
      const row = this.rows.get(id);
      if (
        row?.status === "applying" &&
        row.ownerEmail === ownerEmail &&
        row.stagedExpiresAt <= now
      ) {
        Object.assign(row, {
          status: "expired",
          ciphertext: null,
          iv: null,
          keyVersion: null,
        });
        changes = 1;
      }
    } else if (
      sql.startsWith("UPDATE play_promotion_transactions") &&
      sql.includes("SET status = 'applied'")
    ) {
      const [, id] = values;
      const row = this.rows.get(id);
      if (row?.status === "applying") {
        Object.assign(row, {
          status: "applied",
          ciphertext: null,
          iv: null,
          keyVersion: null,
        });
        changes = 1;
      }
    }
    return { success: true, results: [], meta: { changes } };
  }
}

async function withRuntime(bindings, callback) {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = bindings;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete globalThis.__ANISH_CONNECTOR_TEST_ENV__;
    else globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
}

function productionBindings(database) {
  return {
    DB: database,
    CONNECTOR_ENCRYPTION_KEY: Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString("base64"),
    PRODUCTION_SITE_URL: "https://anish.example",
    SITE_URL: "https://anish.example",
  };
}

test("promotion codes are short-lived bearer capabilities and never stored in plaintext", async () => {
  const database = new PromotionD1();
  const issued = await withRuntime(productionBindings(database), () =>
    issuePlayPromotion({
      ownerEmail: "Anish@Example.com",
      requestUrl: "https://anish.example/api/studio/play-promotion/start",
    }),
  );
  assert.equal(issued.status, "issued");
  assert.match(issued.code, /^play1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const row = [...database.rows.values()][0];
  assert.equal(row.ownerEmail, "anish@example.com");
  assert.equal(row.targetOrigin, "https://anish.example");
  assert.equal(JSON.stringify(row).includes(issued.code), false);
  assert.equal(JSON.stringify(row).includes(issued.code.split(".")[2]), false);
  assert.ok(Date.parse(issued.expiresAt) - Date.now() <= 10 * 60 * 1000);
});

test("a valid code stages only allowlisted providers once and binds the destination origin", async () => {
  const database = new PromotionD1();
  const bindings = productionBindings(database);
  const issued = await withRuntime(bindings, () =>
    issuePlayPromotion({
      ownerEmail: "owner@example.com",
      requestUrl: "https://anish.example/api/studio/play-promotion/start",
    }),
  );
  const payload = {
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    providers: { hardcover: { authorization: "Bearer safe-test-token" } },
  };
  const wrongOrigin = await withRuntime(bindings, () =>
    stagePlayPromotion({
      transferCode: issued.code,
      payload,
      requestUrl: "https://evil.example/api/play-promotion/import",
    }),
  );
  assert.deepEqual(wrongOrigin, { status: "invalid" });

  const staged = await withRuntime(bindings, () =>
    stagePlayPromotion({
      transferCode: issued.code,
      payload,
      requestUrl: "https://anish.example/api/play-promotion/import",
    }),
  );
  assert.deepEqual(staged.providers, ["hardcover"]);
  assert.equal(staged.status, "staged");
  const row = database.rows.get(staged.id);
  assert.equal(row.status, "staged");
  assert.equal(row.providersJson, '["hardcover"]');
  assert.equal(row.ciphertext.includes("safe-test-token"), false);

  const replay = await withRuntime(bindings, () =>
    stagePlayPromotion({
      transferCode: issued.code,
      payload,
      requestUrl: "https://anish.example/api/play-promotion/import",
    }),
  );
  assert.deepEqual(replay, { status: "already_used" });
});

test("promotion validation rejects arbitrary providers, MyAnimeList, and unsafe origins", () => {
  const { canonicalHttpsOrigin, validPortablePayload } = playPromotionInternals;
  assert.equal(canonicalHttpsOrigin("https://anish.example"), "https://anish.example");
  for (const origin of [
    "http://anish.example",
    "https://user:pass@anish.example",
    "https://anish.example/path",
    "https://anish.example?token=x",
  ]) {
    assert.equal(canonicalHttpsOrigin(origin), null, origin);
  }
  assert.equal(
    validPortablePayload({
      schemaVersion: "1.0",
      exportedAt: new Date().toISOString(),
      providers: { myanimelist: { accessToken: "never-transfer" } },
    }),
    false,
  );
  assert.equal(
    validPortablePayload({
      schemaVersion: "1.0",
      exportedAt: new Date().toISOString(),
      providers: { arbitrary: { secret: "never-transfer" } },
    }),
    false,
  );
});

test("promotion validation accepts only canonical Strava portable configuration", () => {
  const { validPortablePayload } = playPromotionInternals;
  const exportedAt = new Date().toISOString();
  const profileUrl = "https://www.strava.com/athletes/37597587";
  const embedUrl =
    "https://www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567";
  assert.equal(
    validPortablePayload({
      schemaVersion: "1.0",
      exportedAt,
      providers: {
        strava: { profileUrl, embedUrl, embedKind: "profile_feed" },
      },
    }),
    true,
  );

  for (const strava of [
    { profileUrl, embedUrl, embedKind: "profile_summary" },
    { profileUrl, embedUrl: null, embedKind: "profile_feed" },
    { profileUrl, embedUrl, embedKind: "profile_feed", secret: "never" },
    null,
  ]) {
    assert.equal(
      validPortablePayload({
        schemaVersion: "1.0",
        exportedAt,
        providers: { strava },
      }),
      false,
      JSON.stringify(strava),
    );
  }
});

test("a thrown apply error releases the transaction lock for a safe retry", async () => {
  const database = new PromotionD1();
  const bindings = productionBindings(database);
  const issued = await withRuntime(bindings, () =>
    issuePlayPromotion({
      ownerEmail: "owner@example.com",
      requestUrl: "https://anish.example/api/studio/play-promotion/start",
    }),
  );
  const staged = await withRuntime(bindings, () =>
    stagePlayPromotion({
      transferCode: issued.code,
      payload: {
        schemaVersion: "1.0",
        exportedAt: new Date().toISOString(),
        providers: {
          hardcover: { authorization: "Bearer safe-test-token" },
        },
      },
      requestUrl: "https://anish.example/api/play-promotion/import",
    }),
  );
  assert.equal(staged.status, "staged");

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider unavailable in test");
  };
  try {
    database.failCompletionBatch = true;
    await assert.rejects(
      withRuntime(bindings, () =>
        applyPlayPromotion({ id: staged.id, ownerEmail: "owner@example.com" }),
      ),
      /simulated completion failure/,
    );
    assert.equal(database.rows.get(staged.id).status, "staged");

    const retried = await withRuntime(bindings, () =>
      applyPlayPromotion({ id: staged.id, ownerEmail: "owner@example.com" }),
    );
    assert.equal(retried.status, "complete");
    assert.equal(database.rows.get(staged.id).status, "applied");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
