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
  constructor(providers = []) { this.providers = providers; this.settings = new Map(); this.audits = []; }
  prepare(sql) { return new Statement(this, sql); }
  async first(statement) {
    if (!statement.sql.includes("FROM editorial_settings")) return null;
    const value = this.settings.get(statement.values[0]);
    return value ? { valueJson: value.valueJson, updatedAt: value.updatedAt, key: statement.values[0] } : null;
  }
  async all(statement) {
    return statement.sql === "SELECT provider FROM connector_credentials"
      ? { results: this.providers.map((provider) => ({ provider })) }
      : { results: [] };
  }
  async run(statement) {
    if (statement.sql.startsWith("INSERT INTO editorial_settings")) {
      const [key, valueJson, , updatedAt] = statement.values;
      this.settings.set(key, { valueJson, updatedAt });
    } else if (statement.sql.startsWith("DELETE FROM editorial_settings")) {
      this.settings.delete(statement.values[0]);
    } else if (statement.sql.startsWith("INSERT INTO audit_log")) {
      this.audits.push(statement.values);
    }
    return { meta: { changes: 1 }, success: true };
  }
  async batch(statements) { return Promise.all(statements.map((statement) => this.run(statement))); }
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
      const providerBindings = activation.values.slice(4, 9);
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

function approval(provider, database) {
  return saveConnectorPublicationApproval({
    provider,
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
