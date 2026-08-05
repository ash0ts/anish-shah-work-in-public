import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [
  { decryptCredential, encryptCredential },
  { fetchHardcoverSnapshot, normalizeHardcoverAuthorization },
  { fetchMyAnimeListSnapshot },
  {
    deleteConnectorCredential,
    getPublicConnectorSnapshot,
    refreshConnector,
    saveConnectorCredential,
  },
  { steamStorageCountries },
  { ConnectorFetchError },
] = await Promise.all([
  import("../lib/server/credential-crypto.ts"),
  import("../lib/server/connectors/hardcover.ts"),
  import("../lib/server/connectors/myanimelist.ts"),
  import("../lib/server/connectors/repository.ts"),
  import("../lib/server/connectors/steam-policy.ts"),
  import("../lib/server/connectors/types.ts"),
]);

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function oversizedJsonResponse() {
  return jsonResponse({ padding: "x".repeat(1_000_100) });
}

function malLibraryItem(id, overrides = {}) {
  return {
    node: {
      id,
      title: `Anime ${id}`,
      start_date: "2020-01-01",
      genres: [{ id: 1, name: "Action" }],
    },
    list_status: {
      status: "completed",
      score: 8,
      num_episodes_watched: 12,
      updated_at: "2026-07-01T12:00:00Z",
    },
    ...overrides,
  };
}

function hardcoverLibraryItem(id, overrides = {}) {
  return {
    status_id: 3,
    rating: 4,
    updated_at: "2026-07-01T12:00:00Z",
    book: { id, title: `Book ${id}`, slug: `book-${id}` },
    ...overrides,
  };
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
  const requests = [];
  const pages = [
    jsonResponse({ id: 42, name: "anish" }),
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
              updated_at: "2026-07-03T08:00:00-04:00",
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
              title: "Delta",
              start_date: "2014-01",
              genres: [{ id: 2, name: "Drama" }],
            },
            list_status: {
              status: "provider_new_status",
              updated_at: "2026-07-04T12:00:00.987654321Z",
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
    }),
  ];

  const result = await withFetch(async (input, init) => {
    requests.push({ url: String(input), init });
    return pages.shift();
  }, () => fetchMyAnimeListSnapshot({ accessToken: " Bearer mal-secret " }));

    assert.equal(requests.length, 3);
    assert.equal(requests[0].init.headers.Authorization, "Bearer mal-secret");
    assert.match(requests[0].url, /^https:\/\/api\.myanimelist\.net\//);
    assert.match(requests[1].url, /^https:\/\/api\.myanimelist\.net\//);
    assert.match(requests[1].url, /[?&]limit=1000(?:&|$)/);
    assert.match(requests[1].url, /[?&]nsfw=true(?:&|$)/);
    assert.equal(result.itemCount, 4);
    assert.equal(result.etag, '"mal-v1"');
  assert.deepEqual(result.publicPayload, {
      provider: "myanimelist",
      snapshotVersion: 3,
      profileUrl: "https://myanimelist.net/profile/anish",
      coverage: "Complete anime library at sync",
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
      scores: [
        { label: "Unscored", count: 2 },
        { label: "8", count: 1 },
        { label: "9", count: 1 },
      ],
      recent: [
        {
          id: "99",
          title: "Delta",
          status: "Other",
          score: null,
          episodesWatched: null,
          updatedAt: "2026-07-04T12:00:00.987Z",
        },
        {
          id: "1",
          title: "Alpha",
          status: "Watching",
          score: 8,
          episodesWatched: 3,
          updatedAt: "2026-07-03T12:00:00.000Z",
        },
        {
          id: "3",
          title: "Gamma",
          status: "On hold",
          score: 0,
          episodesWatched: 1,
          updatedAt: "2026-07-02T12:00:00.000Z",
        },
        {
          id: "2",
          title: "Beta",
          status: "Completed",
          score: 9,
          episodesWatched: 12,
          updatedAt: "2026-07-01T12:00:00.000Z",
        },
      ],
      library: [
        {
          id: "99",
          title: "Delta",
          startDate: "2014-01",
          releaseYear: 2014,
          genres: ["Drama"],
          status: "Other",
          score: null,
          episodesWatched: null,
          updatedAt: "2026-07-04T12:00:00.987Z",
        },
        {
          id: "1",
          title: "Alpha",
          startDate: "1999-04-03",
          releaseYear: 1999,
          genres: ["Action", "Drama"],
          status: "Watching",
          score: 8,
          episodesWatched: 3,
          updatedAt: "2026-07-03T12:00:00.000Z",
        },
        {
          id: "3",
          title: "Gamma",
          startDate: null,
          releaseYear: null,
          genres: ["Comedy"],
          status: "On hold",
          score: 0,
          episodesWatched: 1,
          updatedAt: "2026-07-02T12:00:00.000Z",
        },
        {
          id: "2",
          title: "Beta",
          startDate: "2005-01-01",
          releaseYear: 2005,
          genres: ["Action"],
          status: "Completed",
          score: 9,
          episodesWatched: 12,
          updatedAt: "2026-07-01T12:00:00.000Z",
        },
      ],
  });
});

test("Hardcover success payload deduplicates books and normalizes public fields", async () => {
  const requests = [];
  const responses = [
    jsonResponse({ data: { me: [{ id: 42, username: "anish" }] } }),
    jsonResponse({
      data: {
        user_books: [
          {
            status_id: 3,
            rating: 4.5,
            updated_at: "2026-07-04T00:00:00.123456789Z",
            book: {
              id: 1,
              title: "Book A",
              slug: "book-a",
              image: { url: "https://img/book-a.jpg" },
            },
          },
          {
            status_id: 1,
            updated_at: "2026-07-03T00:00:00Z",
            book: { id: 1, title: "Duplicate A" },
          },
          {
            status_id: 2,
            updated_at: "2026-07-01T20:00:00-04:00",
            book: { id: 2, title: "Book B" },
          },
          {
            status_id: 4,
            rating: 5,
            updated_at: "2026-07-01T00:00:00Z",
            book: { id: 3, title: "Book C" },
          },
        ],
      },
    }),
  ];

  const result = await withFetch(async (_input, init) => {
    requests.push(init);
    return responses.shift();
  }, () => fetchHardcoverSnapshot({ authorization: " hardcover-secret " }));

    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].headers.authorization, "Bearer hardcover-secret");
    assert.match(JSON.parse(requests[0].body).query, /query Viewer/);
    assert.deepEqual(JSON.parse(requests[1].body).variables, {
      userId: 42,
      limit: 250,
      offset: 0,
    });
    const libraryQuery = JSON.parse(requests[1].body).query;
    assert.match(libraryQuery, /\bupdated_at\b/);
    assert.doesNotMatch(libraryQuery, /\bdate_updated\b/);
    assert.match(libraryQuery, /\bimage\s*\{\s*url\s*\}/i);
    assert.equal(result.itemCount, 3);
  assert.deepEqual(result.publicPayload, {
      provider: "hardcover",
      snapshotVersion: 3,
      profileUrl: "https://hardcover.app/@anish",
      coverage: "Complete book library at sync",
      status: [
        { label: "Currently reading", count: 1 },
        { label: "Did not finish", count: 1 },
        { label: "Read", count: 1 },
      ],
      ratings: [
        { label: "4.5", count: 1 },
        { label: "5", count: 1 },
        { label: "Unrated", count: 1 },
      ],
      recent: [
        {
          id: "1",
          title: "Book A",
          slug: "book-a",
          status: "Read",
          rating: 4.5,
          updatedAt: "2026-07-04T00:00:00.123Z",
        },
        {
          id: "2",
          title: "Book B",
          slug: null,
          status: "Currently reading",
          rating: null,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          id: "3",
          title: "Book C",
          slug: null,
          status: "Did not finish",
          rating: 5,
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      library: [
        {
          id: "1",
          title: "Book A",
          slug: "book-a",
          status: "Read",
          rating: 4.5,
          updatedAt: "2026-07-04T00:00:00.123Z",
        },
        {
          id: "2",
          title: "Book B",
          slug: null,
          status: "Currently reading",
          rating: null,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          id: "3",
          title: "Book C",
          slug: null,
          status: "Did not finish",
          rating: 5,
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
  });
});

test("MyAnimeList follows every page and uses a fresh timeout per request", async () => {
  const responses = [
    jsonResponse({ id: 42, name: "anish" }),
    jsonResponse({
      data: Array.from({ length: 1_000 }, (_, index) =>
        malLibraryItem(index + 1),
      ),
      paging: {
        next:
          "https://api.myanimelist.net/v2/users/@me/animelist" +
          "?limit=1000&offset=1000",
      },
    }),
    jsonResponse({ data: [malLibraryItem(1_001)] }),
  ];
  const signals = [];

  const result = await withFetch(async (_input, init) => {
    signals.push(init.signal);
    return responses.shift();
  }, () => fetchMyAnimeListSnapshot({ accessToken: "valid" }));

  assert.equal(result.itemCount, 1_001);
  assert.equal(result.publicPayload.library.length, 1_001);
  assert.equal(result.publicPayload.snapshotVersion, 3);
  assert.equal(signals.length, 3);
  assert.equal(new Set(signals).size, signals.length);
  assert(signals.every((signal) => signal instanceof AbortSignal));
});

test("MyAnimeList rejects unsafe paging and never publishes a partial library", async () => {
  const responses = [
    jsonResponse({ id: 42, name: "anish" }),
    jsonResponse({
      data: [malLibraryItem(1)],
      paging: { next: "https://malicious.example.test/steal-token" },
    }),
  ];

  await withFetch(
    async () => responses.shift(),
    () =>
      expectConnectorError(
        () => fetchMyAnimeListSnapshot({ accessToken: "valid" }),
        { code: "provider_schema_changed" },
      ),
  );
});

test("MyAnimeList fails closed when a library exceeds 5,000 entries", async () => {
  const responses = [jsonResponse({ id: 42, name: "anish" })];
  for (let page = 0; page < 5; page += 1) {
    responses.push(
      jsonResponse({
        data: Array.from({ length: 1_000 }, (_, index) =>
          malLibraryItem(page * 1_000 + index + 1),
        ),
        paging: {
          next:
            "https://api.myanimelist.net/v2/users/@me/animelist" +
            `?limit=1000&offset=${(page + 1) * 1_000}`,
        },
      }),
    );
  }

  await withFetch(
    async () => responses.shift(),
    () =>
      expectConnectorError(
        () => fetchMyAnimeListSnapshot({ accessToken: "valid" }),
        { code: "provider_collection_too_large" },
      ),
  );
});

test("Hardcover paginates the full library with per-request timeouts", async () => {
  const responses = [
    jsonResponse({ data: { me: [{ id: 42, username: "anish" }] } }),
    jsonResponse({
      data: {
        user_books: Array.from({ length: 250 }, (_, index) =>
          hardcoverLibraryItem(index + 1),
        ),
      },
    }),
    jsonResponse({
      data: {
        user_books: [
          hardcoverLibraryItem(251),
          hardcoverLibraryItem(252),
        ],
      },
    }),
  ];
  const requests = [];

  const result = await withFetch(async (_input, init) => {
    requests.push(init);
    return responses.shift();
  }, () => fetchHardcoverSnapshot({ authorization: "valid" }));

  assert.equal(result.itemCount, 252);
  assert.equal(result.publicPayload.library.length, 252);
  assert.equal(result.publicPayload.snapshotVersion, 3);
  assert.deepEqual(
    requests.slice(1).map((request) => JSON.parse(request.body).variables),
    [
      { userId: 42, limit: 250, offset: 0 },
      { userId: 42, limit: 250, offset: 250 },
    ],
  );
  const signals = requests.map((request) => request.signal);
  assert.equal(new Set(signals).size, signals.length);
  assert(signals.every((signal) => signal instanceof AbortSignal));
});

test("Hardcover probes and fails closed beyond 5,000 entries", async () => {
  let libraryRequest = 0;
  await withFetch(
    async (_input, init) => {
      const request = JSON.parse(init.body);
      if (/query Viewer/.test(request.query)) {
        return jsonResponse({
          data: { me: [{ id: 42, username: "anish" }] },
        });
      }
      const offset = libraryRequest * 250;
      libraryRequest += 1;
      const length = offset === 5_000 ? 1 : 250;
      return jsonResponse({
        data: {
          user_books: Array.from({ length }, (_, index) =>
            hardcoverLibraryItem(offset + index + 1),
          ),
        },
      });
    },
    () =>
      expectConnectorError(
        () => fetchHardcoverSnapshot({ authorization: "valid" }),
        { code: "provider_collection_too_large" },
      ),
  );
  assert.equal(libraryRequest, 21);
});

test("Hardcover accepts bare or prefixed tokens and emits one Bearer prefix", () => {
  assert.equal(
    normalizeHardcoverAuthorization(" hardcover-secret "),
    "Bearer hardcover-secret",
  );
  assert.equal(
    normalizeHardcoverAuthorization(" bearer   hardcover-secret "),
    "Bearer hardcover-secret",
  );
  assert.equal(normalizeHardcoverAuthorization("Bearer"), "");
  assert.equal(normalizeHardcoverAuthorization("token with spaces"), "");
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

test("MyAnimeList and Hardcover reject oversized response bodies", async (context) => {
  await context.test("MyAnimeList", async () => {
    await withFetch(
      async () => oversizedJsonResponse(),
      () =>
        expectConnectorError(
          () => fetchMyAnimeListSnapshot({ accessToken: "valid" }),
          { code: "provider_payload_too_large" },
        ),
    );
  });

  await context.test("Hardcover", async () => {
    await withFetch(
      async () => oversizedJsonResponse(),
      () =>
        expectConnectorError(
          () => fetchHardcoverSnapshot({ authorization: "Bearer valid" }),
          { code: "provider_payload_too_large" },
        ),
    );
  });
});

test("provider collection sizes cannot exceed the requested bounds", async (context) => {
  await context.test("MyAnimeList page", async () => {
    const responses = [
      jsonResponse({ id: 42, name: "anish" }),
      jsonResponse({ data: Array.from({ length: 1_001 }, () => ({})) }),
    ];
    await withFetch(
      async () => responses.shift(),
      () =>
        expectConnectorError(
          () => fetchMyAnimeListSnapshot({ accessToken: "valid" }),
          { code: "provider_schema_changed" },
        ),
    );
  });

  await context.test("MyAnimeList genre list", async () => {
    const responses = [
      jsonResponse({ id: 42, name: "anish" }),
      jsonResponse({
        data: [
          {
            node: {
              id: 1,
              title: "Bounded genres",
              genres: Array.from({ length: 65 }, (_, index) => ({
                id: index + 1,
                name: `Genre ${index + 1}`,
              })),
            },
          },
        ],
      }),
    ];
    await withFetch(
      async () => responses.shift(),
      () =>
        expectConnectorError(
          () => fetchMyAnimeListSnapshot({ accessToken: "valid" }),
          { code: "provider_schema_changed" },
        ),
    );
  });

  await context.test("Hardcover library", async () => {
    const responses = [
      jsonResponse({ data: { me: [{ id: 42, username: "anish" }] } }),
      jsonResponse({
        data: {
          user_books: Array.from({ length: 251 }, () => ({})),
        },
      }),
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

test("MyAnimeList rejects wrong-type and unbounded public scalars", async (context) => {
  const scenarios = [
    {
      name: "wrong-type title",
      item: { node: { id: 1, title: 42 } },
    },
    {
      name: "unbounded title",
      item: { node: { id: 1, title: "x".repeat(513) } },
    },
    {
      name: "out-of-range score",
      item: {
        node: { id: 1, title: "Score" },
        list_status: { score: 11 },
      },
    },
    {
      name: "invalid partial date",
      item: { node: { id: 1, title: "Date", start_date: "2026-02-31" } },
    },
    {
      name: "wrong-type update date",
      item: {
        node: { id: 1, title: "Updated" },
        list_status: { updated_at: 20260730 },
      },
    },
    {
      name: "non-ISO update date",
      item: {
        node: { id: 1, title: "Updated" },
        list_status: { updated_at: "2026-07-30 00:00:00Z" },
      },
    },
  ];

  for (const scenario of scenarios) {
    await context.test(scenario.name, async () => {
      const responses = [
        jsonResponse({ id: 42, name: "anish" }),
        jsonResponse({ data: [scenario.item] }),
      ];
      await withFetch(
        async () => responses.shift(),
        () =>
          expectConnectorError(
            () => fetchMyAnimeListSnapshot({ accessToken: "valid" }),
            { code: "provider_schema_changed" },
          ),
      );
    });
  }
});

test("Hardcover rejects wrong-type and unbounded public scalars", async (context) => {
  const scenarios = [
    {
      name: "wrong-type title",
      entry: { book: { id: 1, title: 42 } },
    },
    {
      name: "unbounded title",
      entry: { book: { id: 1, title: "x".repeat(513) } },
    },
    {
      name: "out-of-range rating",
      entry: { rating: 5.5, book: { id: 1, title: "Rating" } },
    },
    {
      name: "invalid update date",
      entry: {
        updated_at: "not-a-date",
        book: { id: 1, title: "Date" },
      },
    },
    {
      name: "wrong-type reading status",
      entry: { status_id: "3", book: { id: 1, title: "Status" } },
    },
  ];

  for (const scenario of scenarios) {
    await context.test(scenario.name, async () => {
      const responses = [
        jsonResponse({ data: { me: [{ id: 42, username: "anish" }] } }),
        jsonResponse({ data: { user_books: [scenario.entry] } }),
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
  }
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
    this.credentials = new Map(
      Object.entries(credentials).map(([provider, credential]) => [
        provider,
        {
          ...structuredClone(credential),
          generation: credential.generation ?? 1,
        },
      ]),
    );
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
      const readyOnly = sql.includes("status = 'ready'");
      return (
        this.snapshots
          .filter(
            (snapshot) =>
              snapshot.provider === provider &&
              (!readyOnly || snapshot.status === "ready"),
          )
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
      const readyOnly = sql.includes("status = 'ready'");
      return {
        results: this.snapshots
          .filter(
            (snapshot) =>
              snapshot.provider === provider &&
              (!readyOnly || snapshot.status === "ready"),
          )
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
      const [id, provider] = values;
      const withheld = sql.includes("'withheld'");
      if (sql.includes("generation = ?")) {
        const conditionOffset = withheld ? 4 : 7;
        const expectedProvider = values[conditionOffset];
        const expectedGeneration = values[conditionOffset + 1];
        const expectedRunId = values[conditionOffset + 2];
        const expectedRunProvider = values[conditionOffset + 3];
        const credential = this.credentials.get(expectedProvider);
        const run = this.runs.find(
          (entry) =>
            entry.id === expectedRunId &&
            entry.provider === expectedRunProvider &&
            entry.status === "running",
        );
        if (
          !credential ||
          credential.generation !== expectedGeneration ||
          !run
        ) {
          return 0;
        }
      }
      const [publicPayloadJson, fetchedAt, freshUntil, etag, itemCount] =
        withheld
          ? ["{}", values[2], values[3], null, 0]
          : values.slice(2, 7);
      this.snapshots.push({
        id,
        provider,
        status: withheld ? "withheld" : "ready",
        publicPayloadJson,
        fetchedAt,
        freshUntil,
        etag,
        itemCount,
      });
      return 1;
    }

    if (sql.includes("INSERT INTO connector_credentials")) {
      const [
        provider,
        ciphertext,
        iv,
        keyVersion,
      ] = values;
      const previous = this.credentials.get(provider);
      this.credentials.set(provider, {
        ciphertext,
        iv,
        keyVersion,
        generation: previous ? previous.generation + 1 : 1,
      });
      return 1;
    }

    if (sql.includes("UPDATE connector_credentials")) {
      const [
        ciphertext,
        iv,
        keyVersion,
        expiresAt,
        updatedAt,
        expectedGeneration,
      ] = values;
      const credential = this.credentials.get("myanimelist");
      if (
        !credential ||
        credential.generation !== expectedGeneration
      ) {
        return 0;
      }
      this.credentials.set("myanimelist", {
        ...credential,
        ciphertext,
        iv,
        keyVersion,
        expiresAt,
        updatedAt,
      });
      return 1;
    }

    if (sql.includes("DELETE FROM connector_snapshots")) {
      const [provider, retainedId] = values;
      if (sql.includes("generation = ?")) {
        const conditionOffset = sql.includes("id NOT IN") ? 1 : 2;
        const expectedProvider = values[conditionOffset];
        const expectedGeneration = values[conditionOffset + 1];
        const expectedRunId = values[conditionOffset + 2];
        const expectedRunProvider = values[conditionOffset + 3];
        const credential = this.credentials.get(expectedProvider);
        const run = this.runs.find(
          (entry) =>
            entry.id === expectedRunId &&
            entry.provider === expectedRunProvider &&
            (entry.status === "running" || entry.status === "withheld"),
        );
        if (
          !credential ||
          credential.generation !== expectedGeneration ||
          !run
        ) {
          return 0;
        }
      }
      if (sql.includes("id NOT IN")) {
        const retained = new Set(
          this.snapshots
            .filter((snapshot) => snapshot.provider === provider)
            .sort(
              (left, right) =>
                right.fetchedAt.localeCompare(left.fetchedAt) ||
                right.id.localeCompare(left.id),
            )
            .slice(0, 2)
            .map((snapshot) => snapshot.id),
        );
        this.snapshots = this.snapshots.filter(
          (snapshot) =>
            snapshot.provider !== provider || retained.has(snapshot.id),
        );
      } else if (sql.includes("id <>")) {
        this.snapshots = this.snapshots.filter(
          (snapshot) =>
            snapshot.provider !== provider || snapshot.id === retainedId,
        );
      } else {
        this.snapshots = this.snapshots.filter(
          (snapshot) => snapshot.provider !== provider,
        );
      }
      return 1;
    }

    if (sql.includes("DELETE FROM connector_credentials")) {
      return this.credentials.delete(values[0]) ? 1 : 0;
    }

    if (sql.includes("DELETE FROM sync_runs")) {
      const [provider, retainedId] = values;
      if (sql.includes("generation = ?")) {
        const expectedProvider = values[2];
        const expectedGeneration = values[3];
        const expectedRunId = values[4];
        const expectedRunProvider = values[5];
        const credential = this.credentials.get(expectedProvider);
        const run = this.runs.find(
          (entry) =>
            entry.id === expectedRunId &&
            entry.provider === expectedRunProvider &&
            entry.status === "withheld",
        );
        if (
          !credential ||
          credential.generation !== expectedGeneration ||
          !run
        ) {
          return 0;
        }
      }
      const before = this.runs.length;
      this.runs = this.runs.filter(
        (run) =>
          run.provider !== provider ||
          (sql.includes("id <>") && run.id === retainedId),
      );
      return before - this.runs.length;
    }

    if (sql.includes("SET status = 'complete'")) {
      const [
        finishedAt,
        itemCount,
        id,
        runProvider,
        credentialProvider,
        expectedGeneration,
      ] = values;
      const run = this.runs.find(
        (entry) =>
          entry.id === id &&
          entry.provider === runProvider &&
          entry.status === "running",
      );
      const credential = this.credentials.get(credentialProvider);
      if (
        !run ||
        !credential ||
        credential.generation !== expectedGeneration
      ) {
        return 0;
      }
      Object.assign(run, { status: "complete", finishedAt, itemCount });
      return 1;
    }

    if (sql.includes("SET status = 'withheld'")) {
      const [
        finishedAt,
        id,
        runProvider,
        credentialProvider,
        expectedGeneration,
      ] = values;
      const run = this.runs.find(
        (entry) =>
          entry.id === id &&
          entry.provider === runProvider &&
          entry.status === "running",
      );
      const credential = this.credentials.get(credentialProvider);
      if (
        !run ||
        !credential ||
        credential.generation !== expectedGeneration
      ) {
        return 0;
      }
      Object.assign(run, {
        status: "withheld",
        finishedAt,
        itemCount: 0,
        errorCode: "visibility_unavailable",
      });
      return 1;
    }

    if (sql.includes("SET status = 'failed'")) {
      if (sql.includes("credential_missing")) {
        const id = values[1];
        const run = this.runs.find((entry) => entry.id === id);
        if (!run) return 0;
        Object.assign(run, {
          status: "failed",
          finishedAt: values[0],
          errorCode: "credential_missing",
        });
      } else {
        const id = values[4];
        const runProvider = values[5];
        const credentialProvider = values[6];
        const expectedGeneration = values[7];
        const run = this.runs.find(
          (entry) =>
            entry.id === id &&
            entry.provider === runProvider &&
            entry.status === "running",
        );
        const credential = this.credentials.get(credentialProvider);
        if (
          !run ||
          !credential ||
          (expectedGeneration !== undefined &&
            credential.generation !== expectedGeneration)
        ) {
          return 0;
        }
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
    id: `snapshot-${provider}-${fetchedAt}`,
    provider,
    status: "ready",
    publicPayloadJson: JSON.stringify(payload),
    fetchedAt,
    freshUntil,
    etag: null,
    itemCount: 1,
  };
}

function storedMalPayload({ id = "1", title, syncedAt, freshUntil, profileUrl = null }) {
  const libraryItem = {
    id,
    title,
    startDate: "2020-01-01",
    releaseYear: 2020,
    genres: ["Action"],
    status: "Completed",
    score: 8,
    episodesWatched: 12,
    updatedAt: syncedAt,
  };
  return {
    provider: "myanimelist",
    snapshotVersion: 3,
    profileUrl,
    coverage: "Complete anime library at sync",
    status: [{ label: "Completed", count: 1 }],
    genres: [{ label: "Action", count: 1 }],
    eras: [{ label: "2020s", count: 1 }],
    scores: [{ label: "8", count: 1 }],
    recent: [{
      id,
      title,
      status: "Completed",
      score: 8,
      episodesWatched: 12,
      updatedAt: syncedAt,
    }],
    library: [libraryItem],
    syncedAt,
    freshUntil,
  };
}

function storedHardcoverPayload({
  id = "1",
  title,
  syncedAt,
  freshUntil,
  profileUrl = "https://hardcover.app/@anish",
}) {
  const libraryItem = {
    id,
    title,
    slug: `book-${id}`,
    status: "Read",
    rating: 4,
    updatedAt: syncedAt,
  };
  return {
    provider: "hardcover",
    snapshotVersion: 3,
    profileUrl,
    coverage: "Complete book library at sync",
    status: [{ label: "Read", count: 1 }],
    ratings: [{ label: "4", count: 1 }],
    recent: [libraryItem],
    library: [libraryItem],
    syncedAt,
    freshUntil,
  };
}

async function encryptedMyAnimeListCredential(key) {
  return encryptCredential({ accessToken: "repository-token" }, key, "myanimelist");
}

async function encryptedHardcoverCredential(key) {
  return encryptCredential(
    { authorization: "Bearer repository-hardcover-token" },
    key,
    "hardcover",
  );
}

async function encryptedDiscogsCredential(key) {
  return encryptCredential(
    {
      kind: "oauth1",
      consumerKey: "repository-consumer-key",
      consumerSecret: "repository-consumer-secret",
      accessToken: "repository-access-token",
      accessTokenSecret: "repository-access-secret",
    },
    key,
    "discogs",
  );
}

async function encryptedMyAnimeListOAuthCredential(
  key,
  overrides = {},
) {
  return encryptCredential(
    {
      kind: "oauth",
      clientId: "client-id-value",
      clientSecret: "client-secret-value",
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      accessTokenExpiresAt: new Date(
        Date.now() + 60 * 60 * 1000,
      ).toISOString(),
      ...overrides,
    },
    key,
    "myanimelist",
  );
}

async function encryptedSteamCredential(key) {
  return encryptCredential(
    {
      apiKey: "a".repeat(32),
      steamId: "76561198000000000",
    },
    key,
    "steam",
  );
}

function deferredBoundary(label, timeoutMs = 10_000) {
  let reach;
  const reached = new Promise((resolve) => {
    reach = resolve;
  });
  return {
    reach,
    async wait() {
      let timeout;
      try {
        await Promise.race([
          reached,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`Timed out waiting for ${label}.`)),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

test("public snapshot returns stale cached data without discarding it", async () => {
  const now = Date.now();
  const fetchedAt = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const freshUntil = new Date(now - 12 * 60 * 60 * 1000).toISOString();
  const oldPayload = storedMalPayload({
    title: "Last known good",
    syncedAt: fetchedAt,
    freshUntil,
  });
  const database = new FakeD1({
    snapshots: [
      storedSnapshot("myanimelist", oldPayload, {
        fetchedAt,
        freshUntil,
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
  const safePayload = storedMalPayload({
    title: "Last safe",
    syncedAt: "2026-07-29T00:00:00.000Z",
    freshUntil: "2026-07-29T12:00:00.000Z",
    profileUrl: "https://myanimelist.net/profile/anish",
  });
  const rejectedPayload = {
    ...safePayload,
    profileUrl: "https://secret@myanimelist.net/profile/anish",
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

test("public snapshot rejects malformed or drifted D1 timestamps", async () => {
  const safePayload = storedMalPayload({
    title: "Last safe timestamp",
    syncedAt: "2026-07-29T00:00:00.000Z",
    freshUntil: "2026-07-29T12:00:00.000Z",
  });
  const driftedPayload = storedMalPayload({
    title: "Drifted timestamp",
    syncedAt: "2026-07-30T00:00:00.000Z",
    freshUntil: "2026-07-30T12:00:00.000Z",
  });
  const database = new FakeD1({
    snapshots: [
      storedSnapshot("myanimelist", safePayload, {
        fetchedAt: safePayload.syncedAt,
        freshUntil: safePayload.freshUntil,
      }),
      storedSnapshot("myanimelist", driftedPayload, {
        fetchedAt: "2026-07-30T00:00:00Z",
        freshUntil: driftedPayload.freshUntil,
      }),
    ],
  });

  const result = await withRuntimeBindings({ DB: database }, () =>
    getPublicConnectorSnapshot("myanimelist"),
  );
  assert.equal(result.status, "ready");
  assert.deepEqual(result.payload, safePayload);
  assert.equal(result.fetchedAt, safePayload.syncedAt);
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

test("retired automatic refresh triggers cannot issue provider requests", async () => {
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
  const schemaUpgrade = await withRuntimeBindings({ DB: database }, () =>
    withFetch(async () => {
      fetchCalls += 1;
      return jsonResponse({ data: [] });
    }, () => refreshConnector("myanimelist", "schema_upgrade", null)),
  );
  assert.deepEqual(schemaUpgrade, {
    status: "not_due",
    provider: "myanimelist",
  });
  assert.equal(fetchCalls, 0);
});

test("duplicate manual refreshes share the database lock", async () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const credential = await encryptedMyAnimeListCredential(key);
  const database = new FakeD1({ credentials: { myanimelist: credential } });
  const fetchStarted = deferredBoundary("duplicate-refresh provider fetch");
  let releaseFetch;
  const pendingResponse = new Promise((resolve) => {
    releaseFetch = resolve;
  });

  await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(async (input) => {
        if (String(input).includes("/v2/users/@me?")) {
          return jsonResponse({ id: 42, name: "anish" });
        }
        fetchStarted.reach();
        return pendingResponse;
      }, async () => {
        const firstRefresh = refreshConnector("myanimelist", "manual", "anish@example.com");
        await fetchStarted.wait();
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

test("disconnect during a provider fetch cannot republish a snapshot", async () => {
  const key = Buffer.alloc(32, 29).toString("base64");
  const credential = await encryptedMyAnimeListCredential(key);
  const database = new FakeD1({ credentials: { myanimelist: credential } });
  const fetchStarted = deferredBoundary("disconnect-during-fetch boundary");
  let releaseFetch;
  const pendingResponse = new Promise((resolve) => {
    releaseFetch = resolve;
  });

  await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(async (input) => {
        if (String(input).includes("/v2/users/@me?")) {
          return jsonResponse({ id: 42, name: "anish" });
        }
        fetchStarted.reach();
        return pendingResponse;
      }, async () => {
        const refresh = refreshConnector(
          "myanimelist",
          "manual",
          "anish@example.com",
        );
        await fetchStarted.wait();
        await deleteConnectorCredential(
          "myanimelist",
          "anish@example.com",
        );
        releaseFetch(jsonResponse({ data: [], paging: {} }));

        assert.deepEqual(await refresh, {
          status: "failed",
          provider: "myanimelist",
          code: "credential_changed",
          retryable: true,
        });
      }),
  );

  assert.equal(database.credentials.has("myanimelist"), false);
  assert.equal(database.snapshots.length, 0);
  assert.equal(database.runs.length, 0);
});

test("credential replacement supersedes an in-flight provider fetch", async () => {
  const key = Buffer.alloc(32, 31).toString("base64");
  const credential = await encryptedMyAnimeListCredential(key);
  const database = new FakeD1({ credentials: { myanimelist: credential } });
  const fetchStarted = deferredBoundary("credential-replacement provider fetch");
  let releaseFetch;
  const pendingResponse = new Promise((resolve) => {
    releaseFetch = resolve;
  });

  await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(async (input) => {
        if (String(input).includes("/v2/users/@me?")) {
          return jsonResponse({ id: 42, name: "anish" });
        }
        fetchStarted.reach();
        return pendingResponse;
      }, async () => {
        const refresh = refreshConnector(
          "myanimelist",
          "manual",
          "anish@example.com",
        );
        await fetchStarted.wait();
        assert.deepEqual(
          await saveConnectorCredential(
            "myanimelist",
            "replacement-access-token",
            "anish@example.com",
          ),
          { status: "saved" },
        );
        releaseFetch(jsonResponse({ data: [], paging: {} }));

        assert.deepEqual(await refresh, {
          status: "failed",
          provider: "myanimelist",
          code: "credential_changed",
          retryable: true,
        });
      }),
  );

  assert.equal(database.snapshots.length, 0);
  assert.equal(database.runs.length, 0);
  assert.deepEqual(
    await decryptCredential(
      database.credentials.get("myanimelist"),
      key,
      "myanimelist",
    ),
    { accessToken: "replacement-access-token" },
  );
  assert.equal(database.credentials.get("myanimelist").generation, 2);
});

test("MyAnimeList proactively refreshes and persists rotated OAuth tokens", async () => {
  const key = Buffer.alloc(32, 23).toString("base64");
  const credential = await encryptedMyAnimeListOAuthCredential(key, {
    accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const database = new FakeD1({ credentials: { myanimelist: credential } });
  const requests = [];

  const result = await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(async (input, init) => {
        const url = String(input);
        requests.push({ url, authorization: init?.headers?.Authorization });
        if (url === "https://myanimelist.net/v1/oauth2/token") {
          return jsonResponse({
            expires_in: 3600,
            access_token: "new-access-token",
            refresh_token: "new-refresh-token",
          });
        }
        if (url.includes("/v2/users/@me?")) {
          assert.equal(init.headers.Authorization, "Bearer new-access-token");
          return jsonResponse({ id: 42, name: "anish" });
        }
        assert.equal(init.headers.Authorization, "Bearer new-access-token");
        return jsonResponse({
          data: [
            malLibraryItem(42, {
              list_status: {
                status: "completed",
                score: 9,
                num_episodes_watched: 24,
                updated_at: "2026-07-31T15:42:13.987654321-04:00",
              },
            }),
          ],
          paging: {},
        });
      }, () => refreshConnector("myanimelist", "manual", "anish@example.com")),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.itemCount, 1);
  assert.equal(
    requests.filter(({ url }) => url.endsWith("/v1/oauth2/token")).length,
    1,
  );
  const stored = await decryptCredential(
    database.credentials.get("myanimelist"),
    key,
    "myanimelist",
  );
  assert.equal(stored.accessToken, "new-access-token");
  assert.equal(stored.refreshToken, "new-refresh-token");
  assert(Date.parse(stored.accessTokenExpiresAt) > Date.now());

  const published = await withRuntimeBindings({ DB: database }, () =>
    getPublicConnectorSnapshot("myanimelist"),
  );
  assert.equal(published.status, "ready");
  assert.equal(published.payload.library.length, 1);
  assert.equal(
    published.payload.library[0].updatedAt,
    "2026-07-31T19:42:13.987Z",
  );
  assert.equal(published.payload.recent[0].updatedAt, "2026-07-31T19:42:13.987Z");
});

test("Hardcover refresh accepts provider timestamps and publishes a ready snapshot", async () => {
  const key = Buffer.alloc(32, 37).toString("base64");
  const credential = await encryptedHardcoverCredential(key);
  const database = new FakeD1({ credentials: { hardcover: credential } });
  const providerTimestamps = [
    "2026-07-31T15:42:13Z",
    "2026-07-31T11:42:13-04:00",
    "2026-07-31T15:42:13.987654321Z",
  ];

  const result = await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(async (_input, init) => {
        const request = JSON.parse(init.body);
        if (/query Viewer/.test(request.query)) {
          return jsonResponse({
            data: { me: [{ id: 42, username: "anish" }] },
          });
        }
        return jsonResponse({
          data: {
            user_books: Array.from({ length: 30 }, (_, index) =>
              hardcoverLibraryItem(index + 1, {
                updated_at: providerTimestamps[index % providerTimestamps.length],
              }),
            ),
          },
        });
      }, () => refreshConnector("hardcover", "manual", "anish@example.com")),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.itemCount, 30);
  assert.equal(database.runs.at(-1).status, "complete");
  assert.equal(database.snapshots.length, 1);

  const published = await withRuntimeBindings({ DB: database }, () =>
    getPublicConnectorSnapshot("hardcover"),
  );
  assert.equal(published.status, "ready");
  assert.equal(published.payload.library.length, 30);
  assert.deepEqual(
    published.payload.library.slice(0, 3).map((book) => book.updatedAt),
    [
      "2026-07-31T15:42:13.000Z",
      "2026-07-31T15:42:13.000Z",
      "2026-07-31T15:42:13.987Z",
    ],
  );
});

test("Hardcover provider failures preserve the last public snapshot", async (context) => {
  for (const scenario of [
    {
      name: "401 credential expiry",
      status: 401,
      code: "credential_expired",
      retryable: false,
    },
    {
      name: "429 rate limit",
      status: 429,
      code: "rate_limited",
      retryable: true,
    },
  ]) {
    await context.test(scenario.name, async () => {
      const key = Buffer.alloc(32, scenario.status === 401 ? 39 : 41).toString(
        "base64",
      );
      const credential = await encryptedHardcoverCredential(key);
      const fetchedAt = new Date(
        Date.now() - 24 * 60 * 60 * 1_000,
      ).toISOString();
      const freshUntil = new Date(
        Date.parse(fetchedAt) + 12 * 60 * 60 * 1_000,
      ).toISOString();
      const oldPayload = storedHardcoverPayload({
        title: "Last known good book",
        syncedAt: fetchedAt,
        freshUntil,
      });
      const database = new FakeD1({
        credentials: { hardcover: credential },
        snapshots: [
          storedSnapshot("hardcover", oldPayload, { fetchedAt, freshUntil }),
        ],
      });

      await withRuntimeBindings(
        { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
        () =>
          withFetch(
            async () =>
              jsonResponse(
                { error: scenario.code },
                { status: scenario.status },
              ),
            async () => {
              const refresh = await refreshConnector(
                "hardcover",
                "manual",
                "anish@example.com",
              );
              assert.deepEqual(refresh, {
                status: "failed",
                provider: "hardcover",
                code: scenario.code,
                retryable: scenario.retryable,
              });
              assert.equal(database.runs.at(-1).errorCode, scenario.code);
              assert.equal(database.snapshots.length, 1);
              assert(
                !database.statementLog.some(({ sql }) =>
                  sql.includes("INSERT INTO connector_snapshots"),
                ),
              );

              const published = await getPublicConnectorSnapshot("hardcover");
              assert.equal(published.status, "ready");
              assert.equal(published.stale, true);
              assert.deepEqual(published.payload, oldPayload);
            },
          ),
      );
    });
  }
});

test("Discogs rate limiting preserves the last accepted catalog row", async () => {
  const key = Buffer.alloc(32, 43).toString("base64");
  const credential = await encryptedDiscogsCredential(key);
  const fetchedAt = new Date(
    Date.now() - 24 * 60 * 60 * 1_000,
  ).toISOString();
  const freshUntil = new Date(
    Date.parse(fetchedAt) + 4 * 60 * 60 * 1_000,
  ).toISOString();
  const priorSnapshot = {
    id: "discogs-last-known-good",
    provider: "discogs",
    status: "ready",
    publicPayloadJson: JSON.stringify({
      provider: "discogs",
      snapshotVersion: 1,
      profileUrl: "https://www.discogs.com/user/example/collection",
      coverage: "Physical releases returned from the public Discogs collection",
      totals: { physicalItems: 0, distinctReleases: 0 },
      formats: [
        { label: "Box set", count: 0 },
        { label: "Vinyl", count: 0 },
        { label: "CD", count: 0 },
        { label: "Cassette", count: 0 },
        { label: "Other", count: 0 },
      ],
      decades: [],
      formatDecadeMatrix: [],
      library: [],
      syncedAt: fetchedAt,
      freshUntil,
    }),
    fetchedAt,
    freshUntil,
    itemCount: 0,
  };
  const database = new FakeD1({
    credentials: { discogs: credential },
    snapshots: [priorSnapshot],
  });

  await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(
        async () =>
          jsonResponse(
            { message: "rate limited" },
            { status: 429, headers: { "retry-after": "120" } },
          ),
        async () => {
          const refresh = await refreshConnector(
            "discogs",
            "manual",
            "anish@example.com",
          );
          assert.equal(refresh.status, "failed");
          assert.equal(refresh.code, "rate_limited");
          assert.equal(database.snapshots.length, 1);
          assert.equal(database.snapshots[0].id, priorSnapshot.id);
          assert(
            !database.statementLog.some(({ sql }) =>
              sql.includes("INSERT INTO connector_snapshots"),
            ),
          );
        },
      ),
  );
});

test("MyAnimeList refreshes once after API 401 and retries with the new token", async () => {
  const key = Buffer.alloc(32, 25).toString("base64");
  const credential = await encryptedMyAnimeListOAuthCredential(key);
  const database = new FakeD1({ credentials: { myanimelist: credential } });
  let identityCalls = 0;
  let tokenCalls = 0;

  const result = await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(async (input, init) => {
        const url = String(input);
        if (url === "https://myanimelist.net/v1/oauth2/token") {
          tokenCalls += 1;
          return jsonResponse({
            expires_in: 3600,
            access_token: "retry-access-token",
            refresh_token: "retry-refresh-token",
          });
        }
        if (url.includes("/v2/users/@me?")) {
          identityCalls += 1;
          if (identityCalls === 1) {
            assert.equal(init.headers.Authorization, "Bearer old-access-token");
            return jsonResponse({ error: "expired" }, { status: 401 });
          }
          assert.equal(init.headers.Authorization, "Bearer retry-access-token");
          return jsonResponse({ id: 42, name: "anish" });
        }
        assert.equal(init.headers.Authorization, "Bearer retry-access-token");
        return jsonResponse({ data: [], paging: {} });
      }, () => refreshConnector("myanimelist", "manual", "anish@example.com")),
  );

  assert.equal(result.status, "complete");
  assert.equal(identityCalls, 2);
  assert.equal(tokenCalls, 1);
});

test("MyAnimeList invalid refresh grant requires owner reauthorization", async () => {
  const key = Buffer.alloc(32, 27).toString("base64");
  const credential = await encryptedMyAnimeListOAuthCredential(key, {
    accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const database = new FakeD1({ credentials: { myanimelist: credential } });

  const result = await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      withFetch(
        async () =>
          jsonResponse({ error: "invalid_grant" }, { status: 400 }),
        () => refreshConnector("myanimelist", "manual", "anish@example.com"),
      ),
  );

  assert.deepEqual(result, {
    status: "failed",
    provider: "myanimelist",
    code: "reauthorization_required",
    retryable: false,
  });
  assert.equal(database.snapshots.length, 0);
});

test("failed refresh preserves the last-known-good snapshot", async () => {
  const key = Buffer.alloc(32, 9).toString("base64");
  const credential = await encryptedMyAnimeListCredential(key);
  const oldPayload = storedMalPayload({
    title: "Last known good",
    syncedAt: "2026-07-01T00:00:00.000Z",
    freshUntil: "2026-07-01T12:00:00.000Z",
  });
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
        async (input) =>
          String(input).includes("/v2/users/@me?")
            ? jsonResponse({ id: 42, name: "anish" })
            : jsonResponse({
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

test("Steam snapshots expire publicly after 72 hours", async () => {
  const now = Date.now();
  const fetchedAt = new Date(now - 73 * 60 * 60 * 1000).toISOString();
  const freshUntil = new Date(now - 61 * 60 * 60 * 1000).toISOString();
  const payload = {
    provider: "steam",
    snapshotVersion: 3,
    profileUrl:
      "https://steamcommunity.com/profiles/76561198000000000",
    coverage: "Complete public Steam library snapshot",
    totals: {
      publicGameCount: 1,
      playedGameCount: 1,
      totalHoursRounded: 10,
    },
    topPlayed: [],
    recent: [],
    playtime: [
      { label: "Unplayed", count: 0 },
      { label: "Under 2h", count: 0 },
      { label: "2–10h", count: 0 },
      { label: "10–50h", count: 1 },
      { label: "50h+", count: 0 },
    ],
    library: [{
      appId: "10",
      title: "Safe Game",
      played: true,
      recentlyPlayed: false,
      totalHoursRounded: 10,
      recentHoursRounded: 0,
    }],
    syncedAt: fetchedAt,
    freshUntil,
  };
  const database = new FakeD1({
    snapshots: [
      storedSnapshot("steam", payload, {
        fetchedAt,
        freshUntil,
      }),
    ],
  });

  const result = await withRuntimeBindings({ DB: database }, () =>
    getPublicConnectorSnapshot("steam"),
  );
  assert.deepEqual(result, {
    status: "unavailable",
    provider: "steam",
    reason: "stale_expired",
  });
});

test("Steam visibility tombstone blocks every older ready snapshot", async () => {
  const database = new FakeD1({
    snapshots: [
      storedSnapshot(
        "steam",
        {
          provider: "steam",
          profileUrl:
            "https://steamcommunity.com/profiles/76561198000000000",
        },
        {
          fetchedAt: "2026-07-29T00:00:00.000Z",
          freshUntil: "2026-07-29T12:00:00.000Z",
        },
      ),
      {
        id: "steam-withheld",
        provider: "steam",
        status: "withheld",
        publicPayloadJson: "{}",
        fetchedAt: "2026-07-30T00:00:00.000Z",
        freshUntil: "2026-07-30T00:00:00.000Z",
        etag: null,
        itemCount: 0,
      },
    ],
  });

  const result = await withRuntimeBindings({ DB: database }, () =>
    getPublicConnectorSnapshot("steam"),
  );
  assert.deepEqual(result, {
    status: "unavailable",
    provider: "steam",
    reason: "visibility_withheld",
  });
});

test("Steam visibility loss writes one tombstone and purges prior public state", async () => {
  const key = Buffer.alloc(32, 13).toString("base64");
  const credential = await encryptedSteamCredential(key);
  const database = new FakeD1({
    credentials: { steam: credential },
    snapshots: [
      storedSnapshot(
        "steam",
        {
          provider: "steam",
          profileUrl:
            "https://steamcommunity.com/profiles/76561198000000000",
        },
        {
          fetchedAt: "2026-07-29T00:00:00.000Z",
          freshUntil: "2026-07-29T12:00:00.000Z",
        },
      ),
    ],
    runs: [
      {
        id: "previous-steam-sync",
        provider: "steam",
        trigger: "manual",
        status: "complete",
        startedAt: "2026-07-29T00:00:00.000Z",
      },
    ],
  });
  const responses = [
    jsonResponse({
      response: {
        players: [{ steamid: "76561198000000000" }],
      },
    }),
    jsonResponse({ response: {} }),
  ];

  const result = await withRuntimeBindings(
    {
      DB: database,
      CONNECTOR_ENCRYPTION_KEY: key,
      STEAM_DATA_STORAGE_COUNTRIES: "United States",
    },
    () =>
      withFetch(
        async () => responses.shift(),
        () => refreshConnector("steam", "manual", "anish@example.com"),
      ),
  );

  assert.equal(result.status, "withheld");
  assert.equal(database.snapshots.length, 1);
  assert.equal(database.snapshots[0].status, "withheld");
  assert.equal(database.runs.length, 1);
  assert.equal(database.runs[0].status, "withheld");
  const publicResult = await withRuntimeBindings({ DB: database }, () =>
    getPublicConnectorSnapshot("steam"),
  );
  assert.equal(publicResult.status, "unavailable");
  assert.equal(publicResult.reason, "visibility_withheld");
});

test("successful Steam refresh retains only the latest two sanitized rows", async () => {
  const key = Buffer.alloc(32, 15).toString("base64");
  const credential = await encryptedSteamCredential(key);
  const database = new FakeD1({
    credentials: { steam: credential },
    snapshots: [
      storedSnapshot(
        "steam",
        {
          provider: "steam",
          profileUrl:
            "https://steamcommunity.com/profiles/76561198000000000",
        },
        {
          fetchedAt: "2026-07-28T00:00:00.000Z",
          freshUntil: "2026-07-28T12:00:00.000Z",
        },
      ),
      storedSnapshot(
        "steam",
        {
          provider: "steam",
          profileUrl:
            "https://steamcommunity.com/profiles/76561198000000000",
        },
        {
          fetchedAt: "2026-07-29T00:00:00.000Z",
          freshUntil: "2026-07-29T12:00:00.000Z",
        },
      ),
    ],
  });
  const responses = [
    jsonResponse({
      response: {
        players: [{ steamid: "76561198000000000" }],
      },
    }),
    jsonResponse({
      response: {
        game_count: 1,
        games: [
          {
            appid: 10,
            name: "Safe Game",
            playtime_forever: 600,
          },
        ],
      },
    }),
    jsonResponse({
      response: {
        total_count: 1,
        games: [
          {
            appid: 10,
            name: "Safe Game",
            playtime_forever: 600,
            playtime_2weeks: 60,
          },
        ],
      },
    }),
  ];

  const result = await withRuntimeBindings(
    {
      DB: database,
      CONNECTOR_ENCRYPTION_KEY: key,
      STEAM_DATA_STORAGE_COUNTRIES: "United States",
    },
    () =>
      withFetch(
        async () => responses.shift(),
        () => refreshConnector("steam", "manual", "anish@example.com"),
      ),
  );

  assert.equal(result.status, "complete");
  assert.equal(database.snapshots.length, 2);
  assert(
    database.snapshots.every(
      (snapshot) =>
        !snapshot.publicPayloadJson.includes("a".repeat(32)) &&
        snapshot.status === "ready",
    ),
  );
});

test("Steam disconnect deletes its credential, snapshots, and sync history", async () => {
  const key = Buffer.alloc(32, 17).toString("base64");
  const credential = await encryptedSteamCredential(key);
  const database = new FakeD1({
    credentials: { steam: credential },
    snapshots: [
      storedSnapshot(
        "steam",
        {
          provider: "steam",
          profileUrl:
            "https://steamcommunity.com/profiles/76561198000000000",
        },
        {
          fetchedAt: "2026-07-30T00:00:00.000Z",
          freshUntil: "2026-07-30T12:00:00.000Z",
        },
      ),
    ],
    runs: [
      {
        id: "previous-steam-sync",
        provider: "steam",
        trigger: "manual",
        status: "complete",
        startedAt: "2026-07-30T00:00:00.000Z",
      },
    ],
  });

  await withRuntimeBindings({ DB: database }, () =>
    deleteConnectorCredential("steam", "anish@example.com"),
  );
  assert.equal(database.credentials.has("steam"), false);
  assert.equal(database.snapshots.length, 0);
  assert.equal(database.runs.length, 0);
});

test("Steam release gate blocks sync until storage countries are disclosed", async () => {
  const database = new FakeD1();
  let fetchCalls = 0;
  const result = await withRuntimeBindings({ DB: database }, () =>
    withFetch(async () => {
      fetchCalls += 1;
      return jsonResponse({});
    }, () => refreshConnector("steam", "manual", "anish@example.com")),
  );

  assert.deepEqual(result, {
    status: "setup_required",
    provider: "steam",
    reason: "storage_disclosure",
  });
  assert.equal(fetchCalls, 0);
  assert.equal(database.runs.length, 0);
});

test("Steam storage countries accept explicit countries and reject placeholders", async () => {
  assert.equal(
    await withRuntimeBindings(
      { STEAM_DATA_STORAGE_COUNTRIES: "United States, Canada" },
      () => steamStorageCountries(),
    ),
    "United States, Canada",
  );
  for (const value of [
    "unknown",
    "global",
    "worldwide",
    "United States<script>",
    "https://example.com",
  ]) {
    assert.equal(
      await withRuntimeBindings(
        { STEAM_DATA_STORAGE_COUNTRIES: value },
        () => steamStorageCountries(),
      ),
      null,
    );
  }
});

test("Steam credentials are encrypted as one provider-bound object", async () => {
  const key = Buffer.alloc(32, 19).toString("base64");
  const apiKey = "b".repeat(32);
  const steamId = "76561198000000000";
  const database = new FakeD1();

  const result = await withRuntimeBindings(
    {
      DB: database,
      CONNECTOR_ENCRYPTION_KEY: key,
      STEAM_DATA_STORAGE_COUNTRIES: "United States",
    },
    () =>
      saveConnectorCredential(
        "steam",
        { apiKey, steamId },
        "anish@example.com",
      ),
  );
  assert.deepEqual(result, { status: "saved" });

  const encrypted = database.credentials.get("steam");
  assert(encrypted);
  assert.equal(JSON.stringify(encrypted).includes(apiKey), false);
  assert.equal(JSON.stringify(encrypted).includes(steamId), false);
  assert.deepEqual(
    await decryptCredential(encrypted, key, "steam"),
    { apiKey, steamId },
  );
});

test("Hardcover credentials are normalized before encrypted storage", async () => {
  const key = Buffer.alloc(32, 21).toString("base64");
  const database = new FakeD1();

  const result = await withRuntimeBindings(
    { DB: database, CONNECTOR_ENCRYPTION_KEY: key },
    () =>
      saveConnectorCredential(
        "hardcover",
        " hardcover-secret ",
        "anish@example.com",
      ),
  );
  assert.deepEqual(result, { status: "saved" });

  const encrypted = database.credentials.get("hardcover");
  assert(encrypted);
  assert.equal(JSON.stringify(encrypted).includes("hardcover-secret"), false);
  assert.deepEqual(
    await decryptCredential(encrypted, key, "hardcover"),
    { authorization: "Bearer hardcover-secret" },
  );
});
