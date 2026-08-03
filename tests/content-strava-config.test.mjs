import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const {
  applyStravaPortableConfig,
  deleteStravaPublicConfig,
  getStravaPortableConfig,
  getStravaPublicConfig,
  isStravaPortableConfig,
  normalizeStravaEmbed,
  normalizeStravaProfileUrl,
  saveStravaPublicConfig,
  verifyStravaEmbed,
} = await import("../lib/server/strava-config.ts");

const PROFILE_URL = "https://www.strava.com/athletes/37597587";
const PROFILE_FEED =
  "https://www.strava.com/athletes/37597587/latest-rides/0123456789abcdef0123456789abcdef01234567";

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

  run() {
    return this.database.run(this);
  }
}

class FakeD1 {
  constructor() {
    this.settings = new Map();
    this.credentials = new Set(["strava"]);
    this.snapshots = ["strava", "steam"];
    this.runs = ["strava", "hardcover"];
    this.audits = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async run(statement) {
    if (statement.sql.startsWith("UPDATE editorial_settings")) {
      const [nextValue, , key, previousValue] = statement.values;
      if (this.settings.get(key) === previousValue) {
        this.settings.set(key, nextValue);
        return { success: true, results: [], meta: { changes: 1 } };
      }
    }
    return { success: true, results: [], meta: { changes: 0 } };
  }

  async batch(statements) {
    return statements.map((statement) => {
      if (statement.sql.startsWith("INSERT INTO editorial_settings")) {
        this.settings.set(statement.values[0], statement.values[1]);
      } else if (statement.sql.startsWith("DELETE FROM editorial_settings")) {
        this.settings.delete(statement.values[0]);
      } else if (statement.sql.startsWith("DELETE FROM connector_credentials")) {
        this.credentials.delete("strava");
      } else if (statement.sql.startsWith("DELETE FROM connector_snapshots")) {
        this.snapshots = this.snapshots.filter((provider) => provider !== "strava");
      } else if (statement.sql.startsWith("DELETE FROM sync_runs")) {
        this.runs = this.runs.filter((provider) => provider !== "strava");
      } else if (statement.sql.startsWith("DELETE FROM audit_log")) {
        this.audits = [];
      } else if (statement.sql.startsWith("INSERT INTO audit_log")) {
        this.audits.push(JSON.parse(statement.values[2]));
      }
      return { success: true, results: [], meta: { changes: 1 } };
    });
  }
}

async function withFetch(mockFetch, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

test("Strava accepts exact generated profile feeds, summaries, activities, and routes", () => {
  assert.deepEqual(normalizeStravaEmbed(PROFILE_FEED), {
    ok: true,
    embedUrl: PROFILE_FEED,
    kind: "profile_feed",
    inferredProfileUrl: PROFILE_URL,
  });
  assert.deepEqual(
    normalizeStravaEmbed(
      `<iframe height='454' width='300' frameborder='0' allowtransparency='true' scrolling='no' src='https://www.strava.com/athletes/37597587/activity-summary/abcdef0123456789abcdef0123456789abcdef01'></iframe>`,
    ),
    {
      ok: true,
      embedUrl:
        "https://www.strava.com/athletes/37597587/activity-summary/abcdef0123456789abcdef0123456789abcdef01",
      kind: "profile_summary",
      inferredProfileUrl: PROFILE_URL,
    },
  );
  assert.deepEqual(
    normalizeStravaEmbed(
      "https://strava-embeds.com/activity/12345?style=standard&fromEmbed=false",
    ),
    {
      ok: true,
      embedUrl:
        "https://strava-embeds.com/activity/12345?fromEmbed=true&style=standard",
      kind: "activity",
      inferredProfileUrl: null,
    },
  );
});

test("Strava profile and embed parsing rejects lookalikes, credentials, and unsafe markup", () => {
  assert.equal(normalizeStravaProfileUrl(PROFILE_URL), PROFILE_URL);
  for (const value of [
    "http://www.strava.com/athletes/37597587",
    "https://strava.com/athletes/37597587",
    "https://www.strava.com/athletes/37597587?token=secret",
    "https://www.strava.com.evil.test/athletes/37597587",
  ]) {
    assert.equal(normalizeStravaProfileUrl(value), null);
  }
  for (const value of [
    "https://www.strava.com/athletes/37597587/latest-rides/not-a-token",
    `${PROFILE_FEED}?token=secret`,
    "https://strava-embeds.com/activity/1?access_token=secret",
    '<iframe src="https://strava-embeds.com/activity/1" onclick="steal()"></iframe>',
    "https://evil.test/activity/1",
  ]) {
    assert.equal(normalizeStravaEmbed(value).ok, false, value);
  }
});

test("Strava health check requires an anonymous frameable 2xx response", async () => {
  const ready = await verifyStravaEmbed(PROFILE_FEED, async () =>
    new Response("ok", { status: 200 }),
  );
  assert.equal(ready.status, "available");

  const redirected = await verifyStravaEmbed(PROFILE_FEED, async () =>
    new Response(null, { status: 302, headers: { location: "/login" } }),
  );
  assert.equal(redirected.status, "unavailable");
  assert.equal(redirected.reason, "redirected");

  const blocked = await verifyStravaEmbed(PROFILE_FEED, async () =>
    new Response("login", {
      status: 200,
      headers: { "x-frame-options": "SAMEORIGIN" },
    }),
  );
  assert.equal(blocked.status, "unavailable");
  assert.equal(blocked.reason, "not_frameable");

  const restrictedAncestors = await verifyStravaEmbed(PROFILE_FEED, async () =>
    new Response("feed", {
      status: 200,
      headers: {
        "content-security-policy":
          "default-src 'self'; frame-ancestors 'self' https://*.strava.com",
      },
    }),
  );
  assert.equal(restrictedAncestors.status, "unavailable");
  assert.equal(restrictedAncestors.reason, "not_frameable");
});

test("portable Strava configuration is canonical, complete, and internally consistent", () => {
  assert.equal(
    isStravaPortableConfig({
      profileUrl: PROFILE_URL,
      embedUrl: PROFILE_FEED,
      embedKind: "profile_feed",
    }),
    true,
  );
  for (const value of [
    {
      profileUrl: PROFILE_URL,
      embedUrl: PROFILE_FEED,
      embedKind: "profile_summary",
    },
    {
      profileUrl: "https://www.strava.com/athletes/42",
      embedUrl: PROFILE_FEED,
      embedKind: "profile_feed",
    },
    {
      profileUrl: PROFILE_URL,
      embedUrl: null,
      embedKind: "profile_feed",
    },
    {
      profileUrl: PROFILE_URL,
      embedUrl: null,
      embedKind: null,
      unexpected: true,
    },
  ]) {
    assert.equal(isStravaPortableConfig(value), false, JSON.stringify(value));
  }
});

test("Strava stores a checked feed but publishes only a same-origin-safe projection", async () => {
  const database = new FakeD1();
  const saved = await withFetch(
    async () => new Response("feed", { status: 200 }),
    () =>
      saveStravaPublicConfig(
        { profileUrl: PROFILE_URL, embed: PROFILE_FEED },
        "owner@example.com",
        database,
      ),
  );
  assert.equal(saved.status, "saved");
  assert.equal(saved.embedStatus, "available");

  const stored = JSON.parse(
    database.settings.get("connector.strava.public_embed"),
  );
  assert.deepEqual(Object.keys(stored).sort(), [
    "checkedAt",
    "embedKind",
    "embedStatus",
    "embedUrl",
    "profileUrl",
    "updatedAt",
  ]);
  assert.deepEqual(await getStravaPortableConfig(database), {
    profileUrl: PROFILE_URL,
    embedUrl: PROFILE_FEED,
    embedKind: "profile_feed",
  });

  const published = await getStravaPublicConfig(database);
  assert.equal(published.status, "ready");
  assert.equal(published.config.profileUrl, PROFILE_URL);
  assert.equal(published.config.embedStatus, "available");
  assert.equal(published.config.embed.embedUrl, PROFILE_FEED);
  assert.equal(JSON.stringify(published).includes("owner@example.com"), false);
});

test("Strava reuses a same-widget health check for twelve hours", async () => {
  const database = new FakeD1();
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return new Response("feed", { status: 200 });
  }, async () => {
    await saveStravaPublicConfig(
      { profileUrl: PROFILE_URL, embed: PROFILE_FEED },
      "owner@example.com",
      database,
    );
    await saveStravaPublicConfig(
      { profileUrl: PROFILE_URL, embed: PROFILE_FEED },
      "owner@example.com",
      database,
    );
  });
  assert.equal(calls, 1);
});

test("public Strava reads recheck stale widgets and persist a profile fallback", async () => {
  const database = new FakeD1();
  const staleAt = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
  const updatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  database.settings.set(
    "connector.strava.public_embed",
    JSON.stringify({
      profileUrl: PROFILE_URL,
      embedUrl: PROFILE_FEED,
      embedKind: "profile_feed",
      embedStatus: "available",
      checkedAt: staleAt,
      updatedAt,
    }),
  );
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "/login" },
    });
  }, async () => {
    const first = await getStravaPublicConfig(database);
    assert.equal(first.status, "ready");
    assert.equal(first.config.embedStatus, "unavailable");
    assert.equal(first.config.embed, null);
    assert.equal(first.config.profileUrl, PROFILE_URL);

    const second = await getStravaPublicConfig(database);
    assert.equal(second.status, "ready");
    assert.equal(second.config.embed, null);
  });
  assert.equal(calls, 1);
  const stored = JSON.parse(
    database.settings.get("connector.strava.public_embed"),
  );
  assert.equal(stored.embedStatus, "unavailable");
  assert.notEqual(stored.checkedAt, staleAt);
});

test("A failing Strava widget keeps a useful profile fallback", async () => {
  const database = new FakeD1();
  const saved = await withFetch(
    async () =>
      new Response(null, { status: 301, headers: { location: "/login" } }),
    () =>
      saveStravaPublicConfig(
        { profileUrl: PROFILE_URL, embed: PROFILE_FEED },
        "owner@example.com",
        database,
      ),
  );
  assert.equal(saved.status, "saved");
  assert.equal(saved.embedStatus, "unavailable");
  const publicResult = await getStravaPublicConfig(database);
  assert.equal(publicResult.status, "ready");
  assert.equal(publicResult.config.embed, null);
  assert.equal(publicResult.config.profileUrl, PROFILE_URL);
});

test("an older stored profile widget is recovered as an unpublished fallback", async () => {
  const database = new FakeD1();
  const updatedAt = new Date().toISOString();
  database.settings.set(
    "connector.strava.public_embed",
    JSON.stringify({ embedUrl: PROFILE_FEED, updatedAt }),
  );
  const portable = await getStravaPortableConfig(database);
  assert.deepEqual(portable, {
    profileUrl: PROFILE_URL,
    embedUrl: PROFILE_FEED,
    embedKind: "profile_feed",
  });
  const published = await getStravaPublicConfig(database);
  assert.equal(published.status, "ready");
  assert.equal(published.config.embed, null);
  assert.equal(published.config.profileUrl, PROFILE_URL);
});

test("Promotion rejects an unframeable Strava widget without replacing production", async () => {
  const database = new FakeD1();
  await withFetch(
    async () => new Response("ok", { status: 200 }),
    () =>
      saveStravaPublicConfig(
        { profileUrl: PROFILE_URL, embed: null },
        "owner@example.com",
        database,
      ),
  );
  const before = database.settings.get("connector.strava.public_embed");
  const result = await withFetch(
    async () =>
      new Response("login", {
        status: 200,
        headers: { "x-frame-options": "SAMEORIGIN" },
      }),
    () =>
      applyStravaPortableConfig(
        {
          profileUrl: PROFILE_URL,
          embedUrl: PROFILE_FEED,
          embedKind: "profile_feed",
        },
        "owner@example.com",
        database,
      ),
  );
  assert.equal(result.status, "failed");
  assert.equal(result.code, "embed_unavailable");
  assert.equal(database.settings.get("connector.strava.public_embed"), before);
});

test("Strava disconnect deletes config and provider-specific state", async () => {
  const database = new FakeD1();
  await saveStravaPublicConfig(
    { profileUrl: PROFILE_URL, embed: null },
    "owner@example.com",
    database,
  );
  const result = await deleteStravaPublicConfig("owner@example.com", database);
  assert.equal(result.status, "disconnected");
  assert.deepEqual(await getStravaPublicConfig(database), {
    status: "unavailable",
    reason: "not_configured",
  });
  assert.equal(database.credentials.has("strava"), false);
  assert.deepEqual(database.snapshots, ["steam"]);
  assert.deepEqual(database.runs, ["hardcover"]);
});

test("Strava routes keep writes owner-only and Play keeps consent", async () => {
  const [configRoute, legacyConfigRoute, handler, publicRoute, play, movement] = await Promise.all([
    readFile(new URL("../app/api/studio/connectors/strava/config/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/strava/config/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/http/strava-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/strava/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/PersonalStreams.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/MovementStream.tsx", import.meta.url), "utf8"),
  ]);
  const mutationRoutes = `${configRoute}\n${legacyConfigRoute}\n${handler}`;
  assert.match(mutationRoutes, /rejectCrossOriginWrite\(request\)/);
  assert.match(mutationRoutes, /authorizeOwnerApi\(\)/);
  assert.match(mutationRoutes, /private, no-store/);
  assert.match(legacyConfigRoute, /status:\s*308/);
  assert.match(publicRoute, /"cache-control": "no-store"/);
  assert.match(publicRoute, /status: 200/);
  assert.match(movement, /state\.payload\.embed\.embedUrl/);
  assert.match(movement, /show && state\.payload\.embed/);
  assert.match(movement, /View the full activity feed on Strava/);
  assert.doesNotMatch(play, /NEXT_PUBLIC_STRAVA_EMBED_URL/);
});
