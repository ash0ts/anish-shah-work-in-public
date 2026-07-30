import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [
  { encryptCredential },
  { fetchHardcoverSnapshot },
  { fetchMyAnimeListSnapshot },
  { getPublicConnectorSnapshot, refreshConnector },
  { ConnectorFetchError },
] = await Promise.all([
  import("../lib/server/credential-crypto.ts"),
  import("../lib/server/connectors/hardcover.ts"),
  import("../lib/server/connectors/myanimelist.ts"),
  import("../lib/server/connectors/repository.ts"),
  import("../lib/server/connectors/types.ts"),
]);

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function withFetch(mockFetch, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withRuntimeBindings(bindings, callback) {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = bindings;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete globalThis.__ANISH_CONNECTOR_TEST_ENV__;
    else globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
}

async function expectConnectorError(action, expected) {
  await assert.rejects(action, (error) => {
    assert(error instanceof ConnectorFetchError);
    assert.equal(error.code, expected.code);
    assert.equal(error.httpStatus, expected.httpStatus ?? null);
    assert.equal(error.retryable, expected.retryable ?? false);
    return true;
  });
}

test("MyAnimeList success payload is normalized, sorted, bounded, and origin-safe", async () => {
  const previousProfile = process.env.MYANIMELIST_PROFILE_URL;
  process.env.MYANIMELIST_PROFILE_URL = "https://myanimelist.net/profile/anish";
  const requests = [];
  const pages = [
    jsonResponse(
      {
        data: [
          {
            node: {
              id: 1,
              title: "Alpha",
              main_picture: { medium: "https://img/alpha-m.jpg", large: "https://img/alpha.jpg" },
              start_date: "1999-04-03",
              genres: [
                { id: 1, name: "Action" },
                { id: 2, name: "Drama" },
              ],
            },
            list_status: {
              status: "watching",
              score: 8,
              num_episodes_watched: 3,
              updated_at: "2026-07-03T12:00:00Z",
            },
          },
          {
            node: {
              id: 2,
              title: "Beta",
              main_picture: { medium: "https://img/beta.jpg" },
              start_date: "2005-01-01",
              genres: [{ id: 1, name: "Action" }],
            },
            list_status: {
              status: "completed",
              score: 9,
              num_episodes_watched: 12,
              updated_at: "2026-07-01T12:00:00Z",
            },
          },
          {
            node: {
              id: 99,
              start_date: "2014-01",
              genres: [{ id: 2, name: "Drama" }],
            },
            list_status: {
              status: "provider_new_status",
              updated_at: "2026-07-04T12:00:00Z",
            },
          },
        ],
        paging: {
          next: "https://api.myanimelist.net/v2/users/@me/animelist?offset=100",
        },
      },
      { headers: { etag: '"mal-v1"' } },
    ),
    jsonResponse({
      data: [
        {
          node: {
            id: 3,
            title: "Gamma",
            genres: [{ id: 3, name: "Comedy" }],
          },
          list_status: {
            status: "on_hold",
            score: 0,
            num_episodes_watched: 1,
            updated_at: "2026-07-02T12:00:00Z",
          },
        },
      ],
      paging: { next: "https://malicious.example.test/steal-token" },
    }),
  ];

  try {
    const result = await withFetch(async (input, init) => {
      requests.push({ url: String(input), init });
      return pages.shift();
    }, () => fetchMyAnimeListSnapshot({ accessToken: " Bearer mal-secret " }));

    assert.equal(requests.length, 2);
    assert.equal(requests[0].init.headers.Authorization, "Bearer mal-secret");
    assert.match(requests[0].url, /^https:\/\/api\.myanimelist\.net\//);
    assert.match(requests[1].url, /^https:\/\/api\.myanimelist\.net\//);
    assert.equal(result.itemCount, 4);
    assert.equal(result.etag, '"mal-v1"');
    assert.deepEqual(result.publicPayload, {
      provider: "myanimelist",
      profileUrl: "https://myanimelist.net/profile/anish",
      coverage: "Current library",
      status: [
        { label: "Completed", count: 1 },
        { label: "On hold", count: 1 },
        { label: "Other", count: 1 },
        { label: "Watching", count: 1 },
      ],
      genres: [
        { label: "Action", count: 2 },
        { label: "Drama", count: 2 },
        { label: "Comedy", count: 1 },
      ],
      eras: [
        { label: "1990s", count: 1 },
        { label: "2000s", count: 1 },
        { label: "2010s", count: 1 },
      ],
      recent: [
        {
          id: "1",
          title: "Alpha",
          status: "Watching",
          score: 8,
          episodesWatched: 3,
          updatedAt: "2026-07-03T12:00:00Z",
        },
        {
          id: "3",
          title: "Gamma",
          status: "On hold",
          score: 0,
          episodesWatched: 1,
          updatedAt: "2026-07-02T12:00:00Z",
        },
        {
          id: "2",
          title: "Beta",
          status: "Completed",
          score: 9,
          episodesWatched: 12,
          updatedAt: "2026-07-01T12:00:00Z",
        },
      ],
    });
  } finally {
    if (previousProfile === undefined) delete process.env.MYANIMELIST_PROFILE_URL;
    else process.env.MYANIMELIST_PROFILE_URL = previousProfile;
  }
});

test("Hardcover success payload deduplicates books and normalizes public fields", async () => {
  const previousProfile = process.env.HARDCOVER_PROFILE_URL;
  process.env.HARDCOVER_PROFILE_URL = "https://hardcover.app/@anish";
  const requests = [];
  const responses = [
    jsonResponse({ data: { me: [{ id: 42, username: "anish" }] } }),
    jsonResponse({
      data: {
        user_books: [
          {
            status_id: 3,
            rating: 4.5,
            date_updated: "2026-07-04T00:00:00Z",
            book: {
              id: 1,
              title: "Book A",
              slug: "book-a",
              image: { url: "https://img/book-a.jpg" },
            },
          },
          {
            status_id: 1,
            date_updated: "2026-07-03T00:00:00Z",
            book: { id: 1, title: "Duplicate A" },
          },
          {
            status_id: 2,
            date_updated: "2026-07-02T00:00:00Z",
            book: { id: 2, title: "Book B" },
          },
          {
            status_id: 4,
            date_updated: "2026-07-01T00:00:00Z",
            book: { id: 3 },
          },
          { status_id: 3, book: { title: "Missing id" } },
        ],
      },
    }),
  ];

  try {
    const result = await withFetch(async (_input, init) => {
      requests.push(init);
      return responses.shift();
    }, () => fetchHardcoverSnapshot({ authorization: " Bearer hardcover-secret " }));

    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].headers.authorization, "Bearer hardcover-secret");
    assert.match(JSON.parse(requests[0].body).query, /query Viewer/);
    assert.deepEqual(JSON.parse(requests[1].body).variables, { userId: 42 });
    assert.doesNotMatch(JSON.parse(requests[1].body).query, /\bimage\b/i);
    assert.equal(result.itemCount, 3);
    assert.deepEqual(result.publicPayload, {
      provider: "hardcover",
      profileUrl: "https://hardcover.app/@anish",
      username: "anish",
      coverage: "Current library",
      status: [
        { label: "Currently reading", count: 1 },
        { label: "Did not finish", count: 1 },
        { label: "Read", count: 1 },
      ],
      recent: [
        {
          id: "1",
          title: "Book A",
          slug: "book-a",
          status: "Read",
          rating: 4.5,
          updatedAt: "2026-07-04T00:00:00Z",
        },
        {
          id: "2",
          title: "Book B",
          slug: null,
          status: "Currently reading",
          rating: null,
          updatedAt: "2026-07-02T00:00:00Z",
        },
      ],
    });
  } finally {
    if (previousProfile === undefined) delete process.env.HARDCOVER_PROFILE_URL;
    else process.env.HARDCOVER_PROFILE_URL = previousProfile;
  }
});

test("both providers reject empty credentials before making a request", async () => {
  let fetchCalls = 0;
  await withFetch(async () => {
    fetchCalls += 1;
    return jsonResponse({});
  }, async () => {
    await expectConnectorError(
      () => fetchMyAnimeListSnapshot({ accessToken: " Bearer   " }),
      { code: "credential_invalid" },
    );
    await expectConnectorError(
      () => fetchHardcoverSnapshot({ authorization: "   " }),
      { code: "credential_invalid" },
    );
  });
  assert.equal(fetchCalls, 0);
});

test("both providers classify 401 as expired credentials", async (context) => {
  await context.test("MyAnimeList", async () => {
    await withFetch(
      async () => jsonResponse({ error: "expired" }, { status: 401 }),
      () =>
        expectConnectorError(
          () => fetchMyAnimeListSnapshot({ accessToken: "expired" }),
          { code: "credential_expired", httpStatus: 401, retryable: false },
        ),
    );
  });
  await context.test("Hardcover", async () => {
    await withFetch(
      async () => jsonResponse({ error: "expired" }, { status: 401 }),
      () =>
        expectConnectorError(
          () => fetchHardcoverSnapshot({ authorization: "Bearer expired" }),
          { code: "credential_expired", httpStatus: 401, retryable: false },
        ),
    );
  });
});

test("both providers classify 429 as retryable rate limiting", async (context) => {
  await context.test("MyAnimeList", async () => {
    await withFetch(
      async () => jsonResponse({ error: "slow down" }, { status: 429 }),
      () =>
        expectConnectorError(
          () => fetchMyAnimeListSnapshot({ accessToken: "valid" }),
          { code: "rate_limited", httpStatus: 429, retryable: true },
        ),
    );
  });
  await context.test("Hardcover", async () => {
    await withFetch(
      async () => jsonResponse({ error: "slow down" }, { status: 429 }),
      () =>
        expectConnectorError(
          () => fetchHardcoverSnapshot({ authorization: "Bearer valid" }),
          { code: "rate_limited", httpStatus: 429, retryable: true },
        ),
    );
  });
});

test("malformed provider payloads fail at the normalization boundary", async (context) => {
  await context.test("MyAnimeList data must be an array", async () => {
    await withFetch(
      async () => jsonResponse({ data: { unexpected: true } }),
      () =>
        expectConnectorError(
          () => fetchMyAnimeListSnapshot({ accessToken: "valid" }),
          { code: "provider_schema_changed" },
        ),
    );
  });
  await context.test("Hardcover identity must contain a reader", async () => {
    await withFetch(
      async () => jsonResponse({ data: { me: [] } }),
      () =>
        expectConnectorError(
          () => fetchHardcoverSnapshot({ authorization: "Bearer valid" }),
          { code: "provider_schema_changed" },
        ),
    );
  });
  await context.test("Hardcover library must be an array", async () => {
    const responses = [
      jsonResponse({ data: { me: { id: 42, username: "anish" } } }),
      jsonResponse({ data: { user_books: { unexpected: true } } }),
    ];
    await withFetch(
      async () => responses.shift(),
      () =>
        expectConnectorError(
          () => fetchHardcoverSnapshot({ authorization: "Bearer valid" }),
          { code: "provider_schema_changed" },
        ),
    );
  });
});

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  first() {
    return this.database.first(this);
  }

  run() {
    return this.database.run(this);
  }

  all() {
    return this.database.all(this);
  }
}

class FakeD1 {
  constructor({ credentials = {}, snapshots = [], runs = [] } = {}) {
    this.credentials = new Map(Object.entries(credentials));
    this.snapshots = structuredClone(snapshots);
    this.runs = structuredClone(runs);
    this.statementLog = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async first(statement) {
    this.statementLog.push({ operation: "first", sql: statement.sql, values: statement.values });
    const sql = statement.sql.replace(/\s+/g, " ");
    if (sql.includes("FROM connector_snapshots")) {
      const provider = statement.values[0];
      return (
        this.snapshots
          .filter((snapshot) => snapshot.provider === provider && snapshot.status === "ready")
          .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))[0] ?? null
      );
    }
    if (sql.includes("FROM connector_credentials")) {
      const provider = statement.values[0];
      const credential = this.credentials.get(provider);
      if (!credential) return null;
      if (sql.includes("SELECT provider")) return { provider };
      return credential;
    }
    if (sql.includes("FROM sync_runs")) {
      const provider = statement.values[0];
      return (
        this.runs
          .filter((run) => run.provider === provider && run.trigger === "stale_revalidate")
          .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
      );
    }
    return null;
  }

  async all(statement) {
    this.statementLog.push({ operation: "all", sql: statement.sql, values: statement.values });
    const sql = statement.sql.replace(/\s+/g, " ");
    if (sql.includes("FROM connector_snapshots")) {
      const provider = statement.values[0];
      return {
        results: this.snapshots
          .filter((snapshot) => snapshot.provider === provider && snapshot.status === "ready")
          .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))
          .slice(0, 25),
        success: true,
        meta: { changes: 0 },
      };
    }
    return { results: [], success: true, meta: { changes: 0 } };
  }

  async run(statement) {
    const result = this.apply(statement);
    return { results: [], success: true, meta: { changes: result } };
  }

  async batch(statements) {
    return statements.map((statement) => ({
      results: [],
      success: true,
      meta: { changes: this.apply(statement) },
    }));
  }

  apply(statement) {
    const sql = statement.sql.replace(/\s+/g, " ");
    const values = statement.values;
    this.statementLog.push({ operation: "write", sql: statement.sql, values });

    if (sql.includes("error_code = 'stale_lock'")) {
      const [finishedAt, provider, staleBefore] = values;
      let changes = 0;
      for (const run of this.runs) {
        if (
          run.provider === provider &&
          run.status === "running" &&
          run.startedAt < staleBefore
        ) {
          Object.assign(run, {
            status: "failed",
            finishedAt,
            errorCode: "stale_lock",
          });
          changes += 1;
        }
      }
      return changes;
    }

    if (sql.includes("INSERT OR IGNORE INTO sync_runs")) {
      const [id, provider, trigger, requestedByEmail, startedAt] = values;
      if (this.runs.some((run) => run.provider === provider && run.status === "running")) {
        return 0;
      }
      this.runs.push({
        id,
        provider,
        trigger,
        requestedByEmail,
        startedAt,
        status: "running",
      });
      return 1;
    }

    if (sql.includes("INSERT INTO connector_snapshots")) {
      const [id, provider, publicPayloadJson, fetchedAt, freshUntil, etag, itemCount] = values;
      this.snapshots.push({
        id,
        provider,
        status: "ready",
        publicPayloadJson,
        fetchedAt,
        freshUntil,
        etag,
        itemCount,
      });
      return 1;
    }

    if (sql.includes("SET status = 'complete'")) {
      const [finishedAt, itemCount, id] = values;
      const run = this.runs.find((entry) => entry.id === id);
      if (!run) return 0;
      Object.assign(run, { status: "complete", finishedAt, itemCount });
      return 1;
    }

    if (sql.includes("SET status = 'failed'")) {
      const id = values.at(-1);
      const run = this.runs.find((entry) => entry.id === id);
      if (!run) return 0;
      if (sql.includes("credential_missing")) {
        Object.assign(run, {
          status: "failed",
          finishedAt: values[0],
          errorCode: "credential_missing",
        });
      } else {
        Object.assign(run, {
          status: "failed",
          finishedAt: values[0],
          httpStatus: values[1],
          errorCode: values[2],
          errorMessage: values[3],
        });
      }
      return 1;
    }

    return 1;
  }
}

function storedSnapshot(provider, payload, { fetchedAt, freshUntil }) {
  return {
    id: `snapshot-${provider}`,
    provider,
    status: "ready",
    publicPayloadJson: JSON.stringify(payload),
    fetchedAt,
    freshUntil,
    etag: null,
    itemCount: 1,
  };
}

async function encryptedMyAnimeListCredential(key) {
  return encryptCredential({ accessToken: "repository-token" }, key, "myanimelist");
}

async function waitFor(predicate, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for deterministic test boundary.");
}

test("public snapshot returns stale cached data without discarding it", async () => {
  const now = Date.now();
  const oldPayload = {
    provider: "myanimelist",
    profileUrl: null,
    recent: [{ id: "old" }],
  };
  const database = new FakeD1({
    snapshots: [
      storedSnapshot("myanimelist", oldPayload, {
        fetchedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        freshUntil: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
      }),
    ],
  });

  const result = await withRuntimeBindings({ DB: database }, () =>
    getPublicConnectorSnapshot("myanimelist"),
  );
  assert.deepEqual(result, {
    status: "ready",
    provider: "myanimelist",
    payload: oldPayload,
    fetchedAt: database.snapshots[0].fetchedAt,
    freshUntil: database.snapshots[0].freshUntil,
    stale: true,
  });
});

test("public snapshot skips a rejected row and serves the last safe snapshot", async () => {
  const safePayload = {
    provider: "myanimelist",
    profileUrl: "https://myanimelist.net/profile/anish",
    marker: "last-safe",
  };
  const rejectedPayload = {
    provider: "myanimelist",
    profileUrl: "https://secret@myanimelist.net/profile/anish",
    marker: "must-not-serve",
  };
  const database = new FakeD1({
    snapshots: [
      storedSnapshot("myanimelist", safePayload, {
        fetchedAt: "2026-07-29T00:00:00.000Z",
        freshUntil: "2026-07-29T12:00:00.000Z",
      }),
      storedSnapshot("myanimelist", rejectedPayload, {
        fetchedAt: "2026-07-30T00:00:00.000Z",
        freshUntil: "2026-07-30T12:00:00.000Z",
      }),
    ],
  });

  const result = await withRuntimeBindings({ DB: database }, () =>
    getPublicConnectorSnapshot("myanimelist"),
  );
  assert.equal(result.status, "ready");
  assert.deepEqual(result.payload, safePayload);
  assert.equal(result.fetchedAt, "2026-07-29T00:00:00.000Z");
});

test("public snapshot rejects storage when no safe row exists", async () => {
  const database = new FakeD1({
    snapshots: [
      storedSnapshot(
        "myanimelist",
        {
          provider: "myanimelist",
          profileUrl: null,
          recent: [{ coverImage: "https://untrusted.example/cover.jpg" }],
        },
        {
          fetchedAt: "2026-07-30T00:00:00.000Z",
          freshUntil: "2026-07-30T12:00:00.000Z",
        },
      ),
    ],
  });

  const result = await withRuntimeBindings({ DB: database }, () =>
    getPublicConnectorSnapshot("myanimelist"),
  );
  assert.deepEqual(result, {
    status: "unavailable",
    provider: "myanimelist",
    reason: "invalid_snapshot",
  });
});

test("automatic refresh is throttled within the twelve-hour window", async () => {
  const database = new FakeD1({
    runs: [
      {
        id: "recent-run",
        provider: "myanimelist",
        trigger: "stale_revalidate",
        status: "complete",
        startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    ],
  });
  let fetchCalls = 0;
  const result = await withRuntimeBindings({ DB: database }, () =>
    withFetch(async () => {
      fetchCalls += 1;
      return jsonResponse({ data: [] });
    }, () => refreshConnector("myanimelist", "stale_revalidate", null)),
  );
  assert.deepEqual(result, { status: "not_due", provider: "myanimelist" });
  assert.equal(fetchCalls, 0);
});

test("duplicate manual refreshes share the database lock", async () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const credential = await encryptedMyAnimeListCredential(key);
  const database = new FakeD1({ credentials: { myanimelist: credential } });
  let fetchStarted = false;
  let releaseFetch;
  const pendingResponse = new Promise((resolve) => {
    releaseFetch = resolve;
  });

  await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(async () => {
        fetchStarted = true;
        return pendingResponse;
      }, async () => {
        const firstRefresh = refreshConnector("myanimelist", "manual", "anish@example.com");
        await waitFor(() => fetchStarted);
        const duplicate = await refreshConnector(
          "myanimelist",
          "manual",
          "anish@example.com",
        );
        assert.deepEqual(duplicate, {
          status: "already_running",
          provider: "myanimelist",
        });
        assert.equal(database.snapshots.length, 0);

        releaseFetch(jsonResponse({ data: [], paging: {} }));
        const completed = await firstRefresh;
        assert.equal(completed.status, "complete");
        assert.equal(completed.itemCount, 0);
        assert.equal(database.snapshots.length, 1);
      }),
  );
});

test("failed refresh preserves the last-known-good snapshot", async () => {
  const key = Buffer.alloc(32, 9).toString("base64");
  const credential = await encryptedMyAnimeListCredential(key);
  const oldPayload = {
    provider: "myanimelist",
    profileUrl: null,
    marker: "last-known-good",
  };
  const database = new FakeD1({
    credentials: { myanimelist: credential },
    snapshots: [
      storedSnapshot("myanimelist", oldPayload, {
        fetchedAt: "2026-07-01T00:00:00.000Z",
        freshUntil: "2026-07-01T12:00:00.000Z",
      }),
    ],
  });

  await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(
        async () => jsonResponse({ error: "slow down" }, { status: 429 }),
        async () => {
          const refresh = await refreshConnector(
            "myanimelist",
            "manual",
            "anish@example.com",
          );
          assert.deepEqual(refresh, {
            status: "failed",
            provider: "myanimelist",
            code: "rate_limited",
            retryable: true,
          });
          assert.equal(database.snapshots.length, 1);
          assert(
            !database.statementLog.some(({ sql }) =>
              sql.includes("INSERT INTO connector_snapshots"),
            ),
          );

          const cached = await getPublicConnectorSnapshot("myanimelist");
          assert.equal(cached.status, "ready");
          assert.deepEqual(cached.payload, oldPayload);
          assert.equal(cached.stale, true);
        },
      ),
  );
});

test("refresh rejects unsafe provider output before writing a snapshot", async () => {
  const key = Buffer.alloc(32, 11).toString("base64");
  const credential = await encryptedMyAnimeListCredential(key);
  const database = new FakeD1({ credentials: { myanimelist: credential } });

  const result = await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(
        async () =>
          jsonResponse({
            data: [
              {
                node: {
                  id: 1,
                  title: "https://localhost/private",
                  genres: [],
                },
                list_status: {
                  status: "watching",
                  updated_at: "2026-07-30T00:00:00.000Z",
                },
              },
            ],
            paging: {},
          }),
        () => refreshConnector("myanimelist", "manual", "anish@example.com"),
      ),
  );

  assert.deepEqual(result, {
    status: "failed",
    provider: "myanimelist",
    code: "public_payload_rejected",
    retryable: false,
  });
  assert.equal(database.snapshots.length, 0);
  assert(
    !database.statementLog.some(({ sql }) =>
      sql.includes("INSERT INTO connector_snapshots"),
    ),
  );
});
