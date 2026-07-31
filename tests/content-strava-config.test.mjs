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

test("Strava accepts current official activity and route embeds and canonicalizes them", async () => {
  assert.deepEqual(
    normalizeStravaEmbed(
      "https://strava-embeds.com/activity/12345?style=standard&fromEmbed=false",
    ),
    {
      ok: true,
      embedUrl:
        "https://strava-embeds.com/activity/12345?fromEmbed=true&style=standard",
    },
  );
  assert.deepEqual(
    normalizeStravaEmbed(
      '<iframe title="Route" src="https://strava-embeds.com/route/3472594576660285996?style=standard&amp;fromEmbed=true&amp;fullWidth=true" loading="lazy"></iframe>',
    ),
    {
      ok: true,
      embedUrl:
        "https://strava-embeds.com/route/3472594576660285996?fromEmbed=true&fullWidth=true&style=standard",
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
        "https://strava-embeds.com/activity/67890?fromEmbed=true&style=standard",
    },
  );
  assert.deepEqual(
    normalizeStravaEmbed(
      "<div class='strava-embed-placeholder' data-embed-type='route' data-embed-id='3472594576660285996' data-style='standard' data-full-width='true' data-slippy='true' data-map-hash='9.51/56.0936/9.8969' data-units='metric' data-distance='10000'></div><script defer src='https://strava-embeds.com/embed.js'></script>",
    ),
    {
      ok: true,
      embedUrl:
        "https://strava-embeds.com/route/3472594576660285996?fromEmbed=true&fullWidth=true&style=standard",
    },
  );
});

test("Strava rejects legacy profile widgets with replacement guidance", () => {
  const legacy = [
    "https://www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "<iframe height='454' width='300' src='https://www.strava.com/athletes/37597587/activity-summary/abcdef0123456789abcdef0123456789abcdef01'></iframe>",
  ];

  for (const value of legacy) {
    const result = normalizeStravaEmbed(value);
    assert.equal(result.ok, false);
    assert.match(result.message, /redirecting.*sign-in/i);
    assert.match(result.message, /current public activity or route/i);
  }
});

test("Strava rejects alternate origins, paths, private tokens, and unsafe input", () => {
  const rejected = [
    null,
    "",
    "http://strava-embeds.com/activity/1",
    "//strava-embeds.com/activity/1",
    "https://www.strava-embeds.com/activity/1",
    "https://strava-embeds.com.evil.test/activity/1",
    "https://strava-embeds.com/posts/1",
    "https://strava-embeds.com/routes/1/embed",
    "https://strava-embeds.com/activity/not-numeric",
    "https://www.strava.com/athletes/37597587",
    "https://www.strava.com/athletes/37597587/latest-rides/not-a-valid-id",
    "https://www.strava.com/athletes/owner/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567?style=standard",
    "https://www.strava.com/activities/1234567890/embed/0123456789abcdef0123456789abcdef01234567",
    "https://strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://www.strava.com.evil.test/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://user:password@www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://www.strava.com:443/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
    "https://user:password@strava-embeds.com/activity/1",
    "https://strava-embeds.com:443/activity/1",
    "https://strava-embeds.com/activity/1#activity",
    "https://strava-embeds.com/activity/1?access_token=secret",
    "https://strava-embeds.com/activity/1?client_secret=secret",
    "https://strava-embeds.com/activity/1?oauth_token=secret",
    "https://strava-embeds.com/activity/1?refresh_token=secret",
    "https://strava-embeds.com/route/1?token=private-share",
    "https://strava-embeds.com/activity/1?api-key=secret",
    "https://strava-embeds.com/activity/1?code=oauth-code",
    "https://strava-embeds.com/activity/1?fromEmbed=true&fromEmbed=false",
    "https://strava-embeds.com/activity/1?fullWidth=true",
    "https://strava-embeds.com/activity/%0a1",
    "https://strava-embeds.com/activity/\n1",
    '<iframe src="https://strava-embeds.com/activity/\n1"></iframe>',
    "<div><iframe src=\"https://strava-embeds.com/activity/1\"></iframe></div>",
    "<iframe title=\"Missing source\"></iframe>",
    '<iframe src="https://strava-embeds.com/activity/1" src="https://strava-embeds.com/activity/2"></iframe>',
    "<div class='strava-embed-placeholder' data-embed-type='activity' data-embed-id='1'></div><script src='https://evil.example/embed.js'></script>",
    "<div class='strava-embed-placeholder' data-embed-type='activity' data-embed-id='1' onclick='steal()'></div><script src='https://strava-embeds.com/embed.js'></script>",
    "<div class='strava-embed-placeholder' data-embed-type='activity' data-embed-id='1' data-token='private'></div><script src='https://strava-embeds.com/embed.js'></script>",
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
    '<iframe src="https://strava-embeds.com/route/123"></iframe>',
    "owner@example.com",
    database,
  );

  assert.equal(result.status, "saved");
  assert.equal(
    result.embedUrl,
    "https://strava-embeds.com/route/123?fromEmbed=true&style=standard",
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
      embedUrl:
        "https://strava-embeds.com/route/123?fromEmbed=true&style=standard",
      coverage: "Official public Strava activity, loaded only after consent.",
      updatedAt: result.updatedAt,
    },
  });

  database.settings.set(
    "connector.strava.public_embed",
    JSON.stringify({
      embedUrl:
        "https://strava-embeds.com/route/123?fromEmbed=true&style=standard",
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
      embedUrl:
        "https://www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567",
      updatedAt: result.updatedAt,
    }),
  );
  assert.deepEqual(await getStravaPublicConfig(database), {
    status: "unavailable",
    reason: "legacy_embed",
  });

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
    "https://strava-embeds.com/activity/12345",
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
  assert.match(publicRoute, /result\.reason === "legacy_embed"/);
  assert.match(publicRoute, /saved Strava profile widget now redirects/);
  assert.doesNotMatch(publicRoute, /updated_by_email|details_json|actorEmail/);
  assert.match(play, /:\s*"strava";/);
  assert.match(play, /src=\{state\.payload\.embedUrl\}/);
  assert.match(play, /\{show \? \(/);
  assert.doesNotMatch(play, /NEXT_PUBLIC_STRAVA_EMBED_URL/);
});
