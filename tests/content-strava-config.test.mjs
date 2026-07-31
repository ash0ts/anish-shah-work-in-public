import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const {
  deleteStravaPublicConfig,
  getStravaPublicConfig,
  normalizeStravaEmbed,
  saveStravaPublicConfig,
} = await import("../lib/server/strava-config.ts");

class FakeStatement {
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
    if (this.sql.includes("FROM editorial_settings")) {
      const valueJson = this.database.settings.get(this.values[0]);
      return valueJson === undefined ? null : { valueJson };
    }
    return null;
  }
}

class FakeD1 {
  constructor() {
    this.settings = new Map();
    this.credentials = new Set(["strava"]);
    this.snapshots = ["strava", "steam"];
    this.runs = ["strava", "hardcover"];
    this.audits = [];
    this.statements = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    return statements.map((statement) => {
      this.statements.push({
        sql: statement.sql,
        values: structuredClone(statement.values),
      });

      if (statement.sql.startsWith("INSERT INTO editorial_settings")) {
        this.settings.set(statement.values[0], statement.values[1]);
      } else if (
        statement.sql.startsWith("DELETE FROM editorial_settings")
      ) {
        this.settings.delete(statement.values[0]);
      } else if (
        statement.sql.startsWith("DELETE FROM connector_credentials")
      ) {
        this.credentials.delete("strava");
      } else if (
        statement.sql.startsWith("DELETE FROM connector_snapshots")
      ) {
        this.snapshots = this.snapshots.filter(
          (provider) => provider !== "strava",
        );
      } else if (statement.sql.startsWith("DELETE FROM sync_runs")) {
        this.runs = this.runs.filter((provider) => provider !== "strava");
      } else if (statement.sql.startsWith("DELETE FROM audit_log")) {
        this.audits = this.audits.filter(
          (entry) => entry.provider !== "strava",
        );
      } else if (statement.sql.startsWith("INSERT INTO audit_log")) {
        this.audits.push({
          action: statement.sql.includes("config_deleted")
            ? "connector.config_deleted"
            : "connector.config_saved",
          provider: "strava",
          values: structuredClone(statement.values),
        });
      }

      return { success: true, results: [], meta: { changes: 1 } };
    });
  }
}

test("Strava accepts one official URL or iframe and stores only the source", async () => {
  assert.deepEqual(
    normalizeStravaEmbed(
      "https://strava-embeds.com/posts/12345?style=standard",
    ),
    {
      ok: true,
      embedUrl: "https://strava-embeds.com/posts/12345?style=standard",
    },
  );
  assert.deepEqual(
    normalizeStravaEmbed(
      '<iframe title="Activity" src="https://strava-embeds.com/posts/12345?style=standard&amp;from_embed=true" loading="lazy"></iframe>',
    ),
    {
      ok: true,
      embedUrl:
        "https://strava-embeds.com/posts/12345?style=standard&from_embed=true",
    },
  );
  const multilineEmbed = await readFile(
    new URL(
      "./fixtures/connectors/strava-multiline-embed.html",
      import.meta.url,
    ),
    "utf8",
  );
  assert.deepEqual(
    normalizeStravaEmbed(multilineEmbed),
    {
      ok: true,
      embedUrl:
        "https://strava-embeds.com/posts/67890?style=standard&from_embed=true",
    },
  );
  assert.deepEqual(
    normalizeStravaEmbed(
      "<iframe height='454' width='300' frameborder='0' allowtransparency='true' scrolling='no' src='https://www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567'></iframe>",
    ),
    {
      ok: true,
      embedUrl:
        "https://www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    },
  );
  assert.deepEqual(
    normalizeStravaEmbed(
      "https://www.strava.com/athletes/37597587/activity-summary/abcdef0123456789abcdef0123456789abcdef01",
    ),
    {
      ok: true,
      embedUrl:
        "https://www.strava.com/athletes/37597587/activity-summary/abcdef0123456789abcdef0123456789abcdef01",
    },
  );
});

test("Strava rejects alternate origins, credentials, ports, and unsafe input", () => {
  const rejected = [
    null,
    "",
    "http://strava-embeds.com/posts/1",
    "//strava-embeds.com/posts/1",
    "https://www.strava-embeds.com/posts/1",
    "https://strava-embeds.com.evil.test/posts/1",
    "https://www.strava.com/athletes/37597587",
    "https://www.strava.com/athletes/37597587/latest-rides/not-a-valid-id",
    "https://www.strava.com/athletes/owner/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567?style=standard",
    "https://www.strava.com/activities/1234567890/embed/0123456789abcdef0123456789abcdef01234567",
    "https://strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://www.strava.com.evil.test/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://user:password@www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://www.strava.com:443/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://user:password@strava-embeds.com/posts/1",
    "https://strava-embeds.com:443/posts/1",
    "https://strava-embeds.com/posts/1#activity",
    "https://strava-embeds.com/posts/1?access_token=secret",
    "https://strava-embeds.com/posts/1?client_secret=secret",
    "https://strava-embeds.com/posts/1?oauth_token=secret",
    "https://strava-embeds.com/posts/1?refresh_token=secret",
    "https://strava-embeds.com/posts/1?api-key=secret",
    "https://strava-embeds.com/posts/1?code=oauth-code",
    "https://strava-embeds.com/posts/%0aheader",
    "https://strava-embeds.com/posts/\n1",
    '<iframe src="https://strava-embeds.com/posts/\n1"></iframe>',
    "<div><iframe src=\"https://strava-embeds.com/posts/1\"></iframe></div>",
    "<iframe title=\"Missing source\"></iframe>",
    '<iframe src="https://strava-embeds.com/posts/1" src="https://strava-embeds.com/posts/2"></iframe>',
  ];

  for (const value of rejected) {
    assert.deepEqual(
      normalizeStravaEmbed(value),
      {
        ok: false,
        code: "invalid_embed",
        message: normalizeStravaEmbed(value).message,
      },
      String(value),
    );
  }
});

test("Strava public storage is sanitized on write and again on read", async () => {
  const database = new FakeD1();
  const result = await saveStravaPublicConfig(
    '<iframe src="https://strava-embeds.com/routes/123/embed"></iframe>',
    "owner@example.com",
    database,
  );

  assert.equal(result.status, "saved");
  assert.equal(
    result.embedUrl,
    "https://strava-embeds.com/routes/123/embed",
  );
  const stored = JSON.parse(
    database.settings.get("connector.strava.public_embed"),
  );
  assert.deepEqual(Object.keys(stored).sort(), ["embedUrl", "updatedAt"]);

  const publicResult = await getStravaPublicConfig(database);
  assert.deepEqual(publicResult, {
    status: "ready",
    config: {
      provider: "strava",
      embedUrl: "https://strava-embeds.com/routes/123/embed",
      coverage: "Official public Strava activity, loaded only after consent.",
      updatedAt: result.updatedAt,
    },
  });

  database.settings.set(
    "connector.strava.public_embed",
    JSON.stringify({
      embedUrl: "https://strava-embeds.com/routes/123/embed",
      updatedAt: result.updatedAt,
      token: "must-never-publish",
      ownerEmail: "must-never-publish@example.com",
    }),
  );
  const safelyProjected = await getStravaPublicConfig(database);
  assert.equal(safelyProjected.status, "ready");
  assert.equal(JSON.stringify(safelyProjected).includes("token"), false);
  assert.equal(JSON.stringify(safelyProjected).includes("ownerEmail"), false);

  database.settings.set(
    "connector.strava.public_embed",
    JSON.stringify({
      embedUrl: "https://evil.example.test/collect",
      updatedAt: result.updatedAt,
      token: "must-never-publish",
    }),
  );
  assert.deepEqual(await getStravaPublicConfig(database), {
    status: "unavailable",
    reason: "invalid_config",
  });

  const writeAudit = database.audits[0];
  assert.equal(JSON.stringify(writeAudit).includes("routes/123"), false);
  assert.deepEqual(JSON.parse(writeAudit.values[2]), {
    configuration: "official_embed",
  });
});

test("Strava disconnect deletes config and provider-specific state", async () => {
  const database = new FakeD1();
  await saveStravaPublicConfig(
    "https://strava-embeds.com/posts/12345",
    "owner@example.com",
    database,
  );
  const result = await deleteStravaPublicConfig(
    "owner@example.com",
    database,
  );

  assert.deepEqual(result, {
    status: "disconnected",
    provider: "strava",
    configDeleted: true,
    snapshotsDeleted: true,
    syncHistoryDeleted: true,
  });
  assert.deepEqual(await getStravaPublicConfig(database), {
    status: "unavailable",
    reason: "not_configured",
  });
  assert.equal(database.credentials.has("strava"), false);
  assert.deepEqual(database.snapshots, ["steam"]);
  assert.deepEqual(database.runs, ["hardcover"]);
  assert.deepEqual(
    database.audits.map((entry) => entry.action),
    ["connector.config_deleted"],
  );
});

test("Strava routes keep writes owner-only and the public response uncached", async () => {
  const [configRoute, publicRoute, play] = await Promise.all([
    readFile(
      new URL(
        "../app/api/connectors/strava/config/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/api/connectors/strava/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/PersonalStreams.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(configRoute, /rejectCrossOriginWrite\(request\)/);
  assert.match(configRoute, /authorizeOwnerApi\(\)/);
  assert.match(configRoute, /private, no-store/);
  assert.match(publicRoute, /"cache-control": "no-store"/);
  assert.doesNotMatch(publicRoute, /updated_by_email|details_json|actorEmail/);
  assert.match(play, /:\s*"strava";/);
  assert.match(play, /src=\{state\.payload\.embedUrl\}/);
  assert.match(play, /\{show \? \(/);
  assert.doesNotMatch(play, /NEXT_PUBLIC_STRAVA_EMBED_URL/);
});
