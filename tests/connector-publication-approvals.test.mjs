import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const {
  activateConnectorPublicationApprovals,
  connectorPublicationApprovalPendingSettingKey,
  connectorPublicationApprovalPendingValue,
  connectorPublicationApprovalSettingKey,
  connectorPublicationGate,
  deleteConnectorPublicationApproval,
  getConnectorPublicationApprovalOverview,
  saveConnectorPublicationApproval,
} = await import("../lib/server/connectors/publication-approval.ts");
const {
  DISCOGS_EXTENDED_DISPLAY_APPROVAL_SETTING_KEY,
} = await import("../lib/server/connectors/discogs-extended-display-approval.ts");

function seedLegacyDiscogsApproval(database, overrides = {}) {
  const updatedAt = overrides.updatedAt ?? "2026-08-01T00:00:00.000Z";
  database.settings.set(DISCOGS_EXTENDED_DISPLAY_APPROVAL_SETTING_KEY, {
    valueJson: JSON.stringify({
      schemaVersion: 1,
      provider: "discogs",
      reference: "legacy-discogs-permission",
      approvedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      enabled: true,
      ...overrides.value,
    }),
    updatedAt,
  });
}

class Statement {
  constructor(database, sql) { this.database = database; this.sql = sql.replace(/\s+/g, " ").trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  first() { return this.database.first(this); }
  all() { return this.database.all(this); }
  run() { return this.database.run(this); }
}

class ApprovalD1 {
  constructor(providers = []) {
    this.providers = providers;
    this.generations = new Map(providers.map((provider) => [provider, 1]));
    this.ivs = new Map(
      providers.map((provider) => [provider, `iv-${provider}-1`]),
    );
    this.settings = new Map();
    this.audits = [];
  }
  prepare(sql) { return new Statement(this, sql); }
  async first(statement) {
    if (statement.sql.includes("FROM connector_credentials")) {
      const provider = statement.values[0];
      return this.providers.includes(provider)
        ? {
            provider,
            generation: this.generations.get(provider) ?? 1,
            iv: this.ivs.get(provider) ?? `iv-${provider}-1`,
          }
        : null;
    }
    if (!statement.sql.includes("FROM editorial_settings")) return null;
    const value = this.settings.get(statement.values[0]);
    return value ? { valueJson: value.valueJson, updatedAt: value.updatedAt, key: statement.values[0] } : null;
  }
  async all(statement) {
    return statement.sql === "SELECT provider, generation, iv FROM connector_credentials"
      ? {
          results: this.providers.map((provider) => ({
            provider,
            generation: this.generations.get(provider) ?? 1,
            iv: this.ivs.get(provider) ?? `iv-${provider}-1`,
          })),
        }
      : { results: [] };
  }
  async run(statement) {
    if (statement.sql.startsWith("INSERT INTO editorial_settings")) {
      const [key, valueJson, , updatedAt] = statement.values;
      if (
        key === "connector.publication_approval.enforcement" &&
        statement.sql.includes("NOT EXISTS ( SELECT 1 FROM editorial_settings WHERE key = ? )") &&
        this.settings.has(key)
      ) {
        return { meta: { changes: 0 }, success: true };
      }
      if (statement.sql.includes("generation = ? AND iv = ?")) {
        const [provider, expectedGeneration, expectedIv] =
          statement.values.slice(4, 7);
        if (
          !this.providers.includes(provider) ||
          (this.generations.get(provider) ?? 1) !== expectedGeneration ||
          (this.ivs.get(provider) ?? `iv-${provider}-1`) !== expectedIv
        ) {
          return { meta: { changes: 0 }, success: true };
        }
      }
      if (
        statement.sql.includes(
          "WHERE key = ? AND value_json = ? AND updated_at = ?",
        ) &&
        key !== "connector.publication_approval.enforcement"
      ) {
        const [settingKey, expectedValue, expectedUpdatedAt] =
          statement.values.slice(4, 7);
        const current = this.settings.get(settingKey);
        if (
          !current ||
          current.valueJson !== expectedValue ||
          current.updatedAt !== expectedUpdatedAt
        ) {
          return { meta: { changes: 0 }, success: true };
        }
      }
      this.settings.set(key, { valueJson, updatedAt });
    } else if (statement.sql.startsWith("DELETE FROM editorial_settings")) {
      if (statement.sql.includes("AND EXISTS")) {
        const [, guardKey, guardValue, guardUpdatedAt] = statement.values;
        const guard = this.settings.get(guardKey);
        if (
          !guard ||
          guard.valueJson !== guardValue ||
          guard.updatedAt !== guardUpdatedAt
        ) {
          return { meta: { changes: 0 }, success: true };
        }
      }
      this.settings.delete(statement.values[0]);
    } else if (statement.sql.startsWith("INSERT INTO audit_log")) {
      if (statement.sql.includes("WHERE EXISTS")) {
        const guardValues = statement.sql.includes("value_json = ?")
          ? statement.values.slice(-3)
          : statement.values.slice(-2);
        const [guardKey, ...expected] = guardValues;
        const guard = this.settings.get(guardKey);
        const matches =
          guard &&
          (expected.length === 2
            ? guard.valueJson === expected[0] && guard.updatedAt === expected[1]
            : guard.updatedAt === expected[0]);
        if (!matches) return { meta: { changes: 0 }, success: true };
      }
      this.audits.push(statement.values);
    }
    return { meta: { changes: 1 }, success: true };
  }
  async batch(statements) { return Promise.all(statements.map((statement) => this.run(statement))); }
}

class ConcurrentActivationD1 extends ApprovalD1 {
  constructor(providers = []) {
    super(providers);
    this.injectConcurrentActivation = true;
    this.concurrentActivatedAt = null;
  }

  async batch(statements) {
    const activation = statements[0];
    if (
      this.injectConcurrentActivation &&
      activation?.values[0] === "connector.publication_approval.enforcement"
    ) {
      assert.match(
        activation.sql,
        /NOT EXISTS \( SELECT 1 FROM editorial_settings WHERE key = \? \)/,
      );
      const candidate = JSON.parse(activation.values[1]);
      this.injectConcurrentActivation = false;
      this.concurrentActivatedAt = candidate.activatedAt;
      this.settings.set("connector.publication_approval.enforcement", {
        valueJson: JSON.stringify({
          schemaVersion: 2,
          mode: "required",
          activatedAt: this.concurrentActivatedAt,
          activationAttemptId: "00000000-0000-4000-8000-000000000001",
        }),
        updatedAt: this.concurrentActivatedAt,
      });
    }
    return super.batch(statements);
  }
}

class DiscogsApprovalCollisionD1 extends ApprovalD1 {
  constructor() {
    super(["discogs"]);
    this.injectCollision = true;
  }

  async batch(statements) {
    const approvalWrite = statements[0];
    if (
      this.injectCollision &&
      approvalWrite?.values[0] ===
        connectorPublicationApprovalSettingKey("discogs")
    ) {
      this.injectCollision = false;
      const candidate = JSON.parse(approvalWrite.values[1]);
      const updatedAt = approvalWrite.values[3];
      this.generations.set("discogs", 2);
      this.ivs.set("discogs", "iv-discogs-2");
      this.settings.set(connectorPublicationApprovalSettingKey("discogs"), {
        valueJson: JSON.stringify({ ...candidate, enabled: !candidate.enabled }),
        updatedAt,
      });
    }
    return super.batch(statements);
  }
}

class ProviderSwapDuringActivationD1 extends ApprovalD1 {
  async batch(statements) {
    const activation = statements[0];
    if (
      activation?.sql.startsWith("INSERT INTO editorial_settings") &&
      activation.values[0] ===
        "connector.publication_approval.enforcement"
    ) {
      this.providers = ["hardcover"];
      const guards = Array.from(
        activation.sql.matchAll(
          /(NOT EXISTS|EXISTS) \( SELECT 1 FROM connector_credentials WHERE provider = \? \)/g,
        ),
      );
      if (guards.length !== 5) {
        throw new Error("activation must guard every provider identity");
      }
      const providerBindings = activation.values.slice(5, 10);
      const guardsMatch = guards.every((match, index) => {
        const exists = this.providers.includes(providerBindings[index]);
        return match[1] === "EXISTS" ? exists : !exists;
      });
      if (!guardsMatch) {
        return statements.map(() => ({
          meta: { changes: 0 },
          success: true,
        }));
      }
    }
    return super.batch(statements);
  }
}

async function withEnvironment(database, callback) {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
    DB: database,
    CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 27).toString("base64"),
  };
  try { return await callback(); }
  finally {
    if (previous === undefined) delete globalThis.__ANISH_CONNECTOR_TEST_ENV__;
    else globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
}

async function configurationRevision(provider, database) {
  const overview = await getConnectorPublicationApprovalOverview(database);
  assert.equal(overview.status, "ready");
  const entry = overview.providers.find((item) => item.provider === provider);
  assert.equal(entry?.configured, true);
  assert.equal(typeof entry.configurationRevision, "string");
  return entry.configurationRevision;
}

async function approval(provider, database) {
  return saveConnectorPublicationApproval({
    provider,
    expectedConfigurationRevision: await configurationRevision(
      provider,
      database,
    ),
    reference: `private-${provider}-agreement`,
    scopes: ["public_display", "retain_last_known_good"],
    approvedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    enabled: true,
    actorEmail: "owner@example.com",
    database,
  });
}

test("publication approvals encrypt references and expose sanitized state", async () => {
  const database = new ApprovalD1(["spotify", "steam"]);
  await withEnvironment(database, async () => {
    assert.equal((await approval("spotify", database)).status, "saved");
    assert.equal((await approval("steam", database)).status, "saved");
    const stored = database.settings.get(connectorPublicationApprovalSettingKey("spotify")).valueJson;
    assert.equal(stored.includes("private-spotify-agreement"), false);
    const overview = await getConnectorPublicationApprovalOverview(database);
    assert.equal(overview.status, "ready");
    assert.equal(overview.enforcement.mode, "report_only");
    assert.equal(overview.activationReady, true);
    assert.equal(JSON.stringify(overview).includes("agreement"), false);
    assert.equal(JSON.stringify(database.audits).includes("agreement"), false);
  });
});

test("report-only grandfathers existing configuration but withholds pending configuration", async () => {
  const grandfathered = new ApprovalD1(["spotify"]);
  const grandfatheredDiscogs = new ApprovalD1(["discogs"]);
  const pending = new ApprovalD1(["spotify"]);
  const configuredAt = "2026-08-12T00:00:00.000Z";
  pending.settings.set(
    connectorPublicationApprovalPendingSettingKey("spotify"),
    {
      valueJson: connectorPublicationApprovalPendingValue(
        "spotify",
        configuredAt,
      ),
      updatedAt: configuredAt,
    },
  );
  await withEnvironment(grandfathered, async () => {
    assert.deepEqual(
      await connectorPublicationGate("spotify", grandfathered),
      {
        status: "allowed",
        mode: "report_only",
        retainLastKnownGood: true,
      },
    );
  });
  await withEnvironment(grandfatheredDiscogs, async () => {
    assert.deepEqual(
      await connectorPublicationGate("discogs", grandfatheredDiscogs),
      {
        status: "allowed",
        mode: "report_only",
        retainLastKnownGood: true,
      },
    );
  });
  await withEnvironment(pending, async () => {
    assert.deepEqual(await connectorPublicationGate("spotify", pending), {
      status: "withheld",
      mode: "report_only",
      retainLastKnownGood: false,
    });
  });
});

test("an explicit private decision overrides report-only grandfathering", async () => {
  const database = new ApprovalD1(["spotify"]);
  await withEnvironment(database, async () => {
    await approval("spotify", database);
    const disabled = await saveConnectorPublicationApproval({
      provider: "spotify",
      expectedConfigurationRevision: await configurationRevision(
        "spotify",
        database,
      ),
      scopes: ["public_display", "retain_last_known_good"],
      approvedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      enabled: false,
      actorEmail: "owner@example.com",
      database,
    });
    assert.equal(disabled.status, "saved");
    assert.deepEqual(await connectorPublicationGate("spotify", database), {
      status: "withheld",
      mode: "report_only",
      retainLastKnownGood: false,
    });
    assert.deepEqual(database.providers, ["spotify"]);
  });
});

test("pending configuration always requires a current complete approval in report-only", async () => {
  const database = new ApprovalD1(["spotify"]);
  const pendingKey =
    connectorPublicationApprovalPendingSettingKey("spotify");
  const configuredAt = "2026-08-12T00:00:00.000Z";
  database.settings.set(pendingKey, {
    valueJson: connectorPublicationApprovalPendingValue(
      "spotify",
      configuredAt,
    ),
    updatedAt: configuredAt,
  });
  await withEnvironment(database, async () => {
    assert.equal((await approval("spotify", database)).status, "saved");
    assert.equal(database.settings.has(pendingKey), true);
    assert.deepEqual(await connectorPublicationGate("spotify", database), {
      status: "allowed",
      mode: "report_only",
      retainLastKnownGood: true,
    });

    const disabled = await saveConnectorPublicationApproval({
      provider: "spotify",
      expectedConfigurationRevision: await configurationRevision(
        "spotify",
        database,
      ),
      scopes: ["public_display", "retain_last_known_good"],
      approvedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      enabled: false,
      actorEmail: "owner@example.com",
      database,
    });
    assert.equal(disabled.status, "saved");
    assert.equal(database.settings.has(pendingKey), true);
    assert.deepEqual(await connectorPublicationGate("spotify", database), {
      status: "withheld",
      mode: "report_only",
      retainLastKnownGood: false,
    });

    const expiring = await saveConnectorPublicationApproval({
      provider: "spotify",
      expectedConfigurationRevision: await configurationRevision(
        "spotify",
        database,
      ),
      scopes: ["public_display", "retain_last_known_good"],
      approvedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-14T00:00:00.000Z",
      enabled: true,
      actorEmail: "owner@example.com",
      database,
    });
    assert.equal(expiring.status, "saved");
    assert.deepEqual(
      await connectorPublicationGate(
        "spotify",
        database,
        Date.parse("2026-08-15T00:00:00.000Z"),
      ),
      {
        status: "withheld",
        mode: "report_only",
        retainLastKnownGood: false,
      },
    );

    await deleteConnectorPublicationApproval("spotify", database);
    assert.equal(database.settings.has(pendingKey), false);
    assert.equal(
      database.settings.has(
        connectorPublicationApprovalSettingKey("spotify"),
      ),
      false,
    );
  });
});

test("required mode withholds a missing approval without deleting state", async () => {
  const database = new ApprovalD1(["spotify"]);
  await withEnvironment(database, async () => {
    await approval("spotify", database);
    assert.equal((await activateConnectorPublicationApprovals({ actorEmail: "owner@example.com", database })).status, "activated");
    database.settings.delete(connectorPublicationApprovalSettingKey("spotify"));
    assert.deepEqual(await connectorPublicationGate("spotify", database), {
      status: "withheld",
      mode: "required",
      retainLastKnownGood: false,
    });
    assert.deepEqual(database.providers, ["spotify"]);
  });
});

test("activation requires complete unified approvals for every configured provider", async () => {
  const database = new ApprovalD1(["spotify", "steam"]);
  await withEnvironment(database, async () => {
    await approval("spotify", database);
    assert.deepEqual(
      await activateConnectorPublicationApprovals({
        actorEmail: "owner@example.com",
        database,
      }),
      { status: "incomplete", missingProviders: ["steam"] },
    );
    const overview = await getConnectorPublicationApprovalOverview(database);
    assert.equal(overview.status, "ready");
    assert.equal(overview.enforcement.mode, "report_only");
  });
});

test("activation is idempotent and preserves the first activation record", async () => {
  const database = new ApprovalD1(["spotify"]);
  await withEnvironment(database, async () => {
    await approval("spotify", database);
    const first = await activateConnectorPublicationApprovals({
      actorEmail: "owner@example.com",
      database,
    });
    assert.equal(first.status, "activated");
    const stored = database.settings.get(
      "connector.publication_approval.enforcement",
    );
    const auditsAfterFirst = database.audits.length;

    const second = await activateConnectorPublicationApprovals({
      actorEmail: "owner@example.com",
      database,
    });
    assert.equal(second.status, "activated");
    assert.deepEqual(second.enforcement, first.enforcement);
    assert.deepEqual(
      database.settings.get("connector.publication_approval.enforcement"),
      stored,
    );
    assert.equal(database.audits.length, auditsAfterFirst);
  });
});

test("concurrent activation preserves the first committed activation", async () => {
  const database = new ConcurrentActivationD1(["spotify"]);
  await withEnvironment(database, async () => {
    await approval("spotify", database);
    const auditsBeforeActivation = database.audits.length;
    const result = await activateConnectorPublicationApprovals({
      actorEmail: "owner@example.com",
      database,
    });
    assert.equal(result.status, "activated");
    assert.equal(
      result.enforcement.activatedAt,
      database.concurrentActivatedAt,
    );
    assert.equal(database.audits.length, auditsBeforeActivation);
    assert.equal(
      JSON.parse(
        database.settings.get(
          "connector.publication_approval.enforcement",
        ).valueJson,
      ).activatedAt,
      database.concurrentActivatedAt,
    );
  });
});

test("approval writes reject a stale connection revision after replacement", async () => {
  const database = new ApprovalD1(["spotify"]);
  await withEnvironment(database, async () => {
    assert.equal((await approval("spotify", database)).status, "saved");
    const approvalKey = connectorPublicationApprovalSettingKey("spotify");
    const staleRevision = await configurationRevision("spotify", database);
    database.settings.delete(approvalKey);
    database.generations.set("spotify", 2);
    database.ivs.set("spotify", "iv-spotify-2");
    const auditsBeforeStaleWrite = database.audits.length;

    const stale = await saveConnectorPublicationApproval({
      provider: "spotify",
      expectedConfigurationRevision: staleRevision,
      reference: "permission-for-replaced-account",
      scopes: ["public_display", "retain_last_known_good"],
      approvedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: null,
      enabled: true,
      actorEmail: "owner@example.com",
      database,
    });
    assert.deepEqual(stale, {
      status: "invalid",
      reason: "stale_configuration",
    });
    assert.equal(database.settings.has(approvalKey), false);
    assert.equal(database.audits.length, auditsBeforeStaleWrite);

    const current = await saveConnectorPublicationApproval({
      provider: "spotify",
      expectedConfigurationRevision: await configurationRevision(
        "spotify",
        database,
      ),
      reference: "permission-for-current-account",
      scopes: ["public_display", "retain_last_known_good"],
      approvedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: null,
      enabled: true,
      actorEmail: "owner@example.com",
      database,
    });
    assert.equal(current.status, "saved");
    assert.equal(database.settings.has(approvalKey), true);
  });
});

test("disconnect and reconnect cannot reuse an old permission revision", async () => {
  const database = new ApprovalD1(["spotify"]);
  await withEnvironment(database, async () => {
    const disconnectedRevision = await configurationRevision(
      "spotify",
      database,
    );
    database.providers = [];
    database.generations.delete("spotify");
    database.ivs.delete("spotify");
    database.providers = ["spotify"];
    database.generations.set("spotify", 1);
    database.ivs.set("spotify", "iv-spotify-reconnected");

    const stale = await saveConnectorPublicationApproval({
      provider: "spotify",
      expectedConfigurationRevision: disconnectedRevision,
      reference: "permission-from-before-disconnect",
      scopes: ["public_display", "retain_last_known_good"],
      approvedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: null,
      enabled: true,
      actorEmail: "owner@example.com",
      database,
    });
    assert.deepEqual(stale, {
      status: "invalid",
      reason: "stale_configuration",
    });
    assert.equal(
      database.settings.has(
        connectorPublicationApprovalSettingKey("spotify"),
      ),
      false,
    );
  });
});

test("same-millisecond Strava replacement invalidates the old permission revision", async () => {
  const database = new ApprovalD1();
  const updatedAt = "2026-08-13T12:00:00.000Z";
  database.settings.set("connector.strava.public_embed", {
    valueJson: JSON.stringify({
      profileUrl: "https://www.strava.com/athletes/111",
      updatedAt,
    }),
    updatedAt,
  });
  await withEnvironment(database, async () => {
    const staleRevision = await configurationRevision("strava", database);
    database.settings.set("connector.strava.public_embed", {
      valueJson: JSON.stringify({
        profileUrl: "https://www.strava.com/athletes/222",
        updatedAt,
      }),
      updatedAt,
    });
    const result = await saveConnectorPublicationApproval({
      provider: "strava",
      expectedConfigurationRevision: staleRevision,
      reference: "permission-for-old-strava-profile",
      scopes: ["public_display", "retain_last_known_good"],
      approvedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: null,
      enabled: true,
      actorEmail: "owner@example.com",
      database,
    });
    assert.deepEqual(result, {
      status: "invalid",
      reason: "stale_configuration",
    });
    assert.equal(
      database.settings.has(
        connectorPublicationApprovalSettingKey("strava"),
      ),
      false,
    );
  });
});

test("a stale same-timestamp Discogs write cannot audit or delete legacy state", async () => {
  const database = new DiscogsApprovalCollisionD1();
  seedLegacyDiscogsApproval(database);
  await withEnvironment(database, async () => {
    const revision = await configurationRevision("discogs", database);
    const auditsBefore = database.audits.length;
    const result = await saveConnectorPublicationApproval({
      provider: "discogs",
      expectedConfigurationRevision: revision,
      reference: "stale-discogs-permission",
      scopes: ["public_display", "retain_last_known_good"],
      approvedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: null,
      enabled: true,
      actorEmail: "owner@example.com",
      database,
    });
    assert.deepEqual(result, {
      status: "invalid",
      reason: "stale_configuration",
    });
    assert.equal(
      database.settings.has(DISCOGS_EXTENDED_DISPLAY_APPROVAL_SETTING_KEY),
      true,
    );
    assert.equal(database.audits.length, auditsBefore);
  });
});

test("activation fails atomically when the configured provider identity changes", async () => {
  const database = new ProviderSwapDuringActivationD1(["spotify"]);
  await withEnvironment(database, async () => {
    await approval("spotify", database);
    assert.deepEqual(
      await activateConnectorPublicationApprovals({
        actorEmail: "owner@example.com",
        database,
      }),
      { status: "incomplete", missingProviders: ["hardcover"] },
    );
    const overview = await getConnectorPublicationApprovalOverview(database);
    assert.equal(overview.status, "ready");
    assert.equal(overview.enforcement.mode, "report_only");
  });
});

test("legacy Discogs permission works in report-only but cannot activate enforcement", async () => {
  const database = new ApprovalD1(["discogs"]);
  await withEnvironment(database, async () => {
    seedLegacyDiscogsApproval(database);
    assert.deepEqual(
      await connectorPublicationGate(
        "discogs",
        database,
        Date.parse("2026-08-12T00:00:00.000Z"),
      ),
      {
        status: "allowed",
        mode: "report_only",
        retainLastKnownGood: true,
      },
    );
    const overview = await getConnectorPublicationApprovalOverview(
      database,
      Date.parse("2026-08-12T00:00:00.000Z"),
    );
    assert.equal(overview.status, "ready");
    assert.equal(overview.activationReady, false);
    assert.equal(overview.providers.find((entry) => entry.provider === "discogs").approval.source, "legacy_discogs");
    assert.deepEqual(
      await activateConnectorPublicationApprovals({
        actorEmail: "owner@example.com",
        database,
      }),
      { status: "incomplete", missingProviders: ["discogs"] },
    );
  });
});

test("approval updates reuse the encrypted reference and disabled approval withholds without deletion", async () => {
  const database = new ApprovalD1(["spotify"]);
  await withEnvironment(database, async () => {
    await approval("spotify", database);
    assert.equal(
      (
        await activateConnectorPublicationApprovals({
          actorEmail: "owner@example.com",
          database,
        })
      ).status,
      "activated",
    );
    const storedBefore = JSON.parse(
      database.settings.get(
        connectorPublicationApprovalSettingKey("spotify"),
      ).valueJson,
    ).encryptedReference;
    const updated = await saveConnectorPublicationApproval({
      provider: "spotify",
      expectedConfigurationRevision: await configurationRevision(
        "spotify",
        database,
      ),
      scopes: ["public_display", "retain_last_known_good"],
      approvedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      enabled: false,
      actorEmail: "owner@example.com",
      database,
    });
    assert.equal(updated.status, "saved");
    const storedAfter = JSON.parse(
      database.settings.get(
        connectorPublicationApprovalSettingKey("spotify"),
      ).valueJson,
    ).encryptedReference;
    assert.deepEqual(storedAfter, storedBefore);
    assert.deepEqual(await connectorPublicationGate("spotify", database), {
      status: "withheld",
      mode: "required",
      retainLastKnownGood: false,
    });
    assert.deepEqual(database.providers, ["spotify"]);
  });
});
