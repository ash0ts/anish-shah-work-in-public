import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [
  discogs,
  gallery,
  payloadPolicy,
  presentation,
  repository,
  retryState,
  refreshRepository,
  retryUi,
] = await Promise.all([
  import("../lib/server/connectors/discogs.ts"),
  import("../lib/server/connectors/public-gallery.ts"),
  import("../lib/server/connectors/public-payload-policy.ts"),
  import("../lib/server/connectors/discogs-presentation.ts"),
  import("../lib/server/connectors/repository.ts"),
  import("../lib/server/connectors/discogs-retry.ts"),
  import("../lib/server/connectors/repository-refresh.ts"),
  import("../app/studio/connectors/retry-deadline.ts"),
]);

const credential = {
  kind: "oauth1",
  consumerKey: "consumer-key-example",
  consumerSecret: "consumer-secret-example",
  accessToken: "access-token-example",
  accessTokenSecret: "access-secret-example",
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function providerRelease({
  id,
  title = `Release ${id}`,
  artist = `Artist ${id}`,
  year = 2024,
  formats = [{ name: "Vinyl", descriptions: ["LP"] }],
} = {}) {
  return {
    id,
    instance_id: id * 10,
    folder_id: 0,
    date_added: "2026-08-01T00:00:00Z",
    rating: 5,
    notes: [{ field_id: 1, value: "must not survive" }],
    basic_information: {
      id,
      title,
      year,
      artists: [
        {
          name: artist,
          resource_url: `https://api.discogs.com/artists/${id}`,
        },
      ],
      formats,
      thumb: "https://i.discogs.com/private-thumb.jpg",
      cover_image: "https://i.discogs.com/private-cover.jpg",
      resource_url: `https://api.discogs.com/releases/${id}`,
    },
  };
}

async function withFetch(mock, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
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

function storedDiscogsPayload(overrides = {}) {
  const syncedAt = overrides.syncedAt ?? new Date().toISOString();
  const freshUntil =
    overrides.freshUntil ??
    new Date(Date.parse(syncedAt) + 4 * 60 * 60 * 1000).toISOString();
  return {
    provider: "discogs",
    snapshotVersion: 1,
    profileUrl: "https://www.discogs.com/user/collection_example/collection",
    coverage: "Physical releases returned from the public Discogs collection",
    totals: { physicalItems: 2, distinctReleases: 1 },
    formats: [
      { label: "Box set", count: 0 },
      { label: "Vinyl", count: 2 },
      { label: "CD", count: 0 },
      { label: "Cassette", count: 0 },
      { label: "Other", count: 0 },
    ],
    decades: [{ label: "2020s", count: 2 }],
    formatDecadeMatrix: [
      { format: "Vinyl", decade: "2020s", count: 2 },
    ],
    library: [
      {
        releaseId: "11",
        title: "Bounded Release",
        artists: ["Bounded Artist"],
        releaseYear: 2024,
        format: "Vinyl",
        copyCount: 2,
      },
    ],
    syncedAt,
    freshUntil,
  };
}

function seedLegacyDiscogsApproval(database, overrides = {}) {
  const updatedAt = overrides.updatedAt ?? new Date().toISOString();
  database.settings.set("connector.discogs.extended_display_approval", {
    valueJson: JSON.stringify({
      schemaVersion: 1,
      provider: "discogs",
      reference: "owner-permission-reference-2026",
      approvedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: null,
      enabled: true,
      ...overrides.value,
    }),
    updatedAt,
  });
}

test("Discogs catalog normalization reconciles copies and drops private provider fields", async () => {
  const requests = [];
  const releases = [
    providerRelease({
      id: 1,
      title: "Boxed Work",
      artist: "Alpha",
      formats: [{ name: "Box Set" }, { name: "Vinyl" }],
    }),
    providerRelease({ id: 1, title: "Boxed Work", artist: "Alpha" , formats: [{ name: "Box Set" }, { name: "Vinyl" }] }),
    providerRelease({ id: 2, artist: "Beta", year: 1999 }),
    providerRelease({ id: 3, artist: "Gamma", year: 2001, formats: [{ name: "CD" }] }),
    providerRelease({ id: 4, artist: "Delta", year: 1985, formats: [{ name: "Cassette" }] }),
    providerRelease({ id: 5, artist: "Epsilon", year: 0, formats: [{ name: "File" }] }),
  ];

  const result = await withFetch(async (input, init) => {
    assert.equal(typeof input, "string");
    requests.push({ url: String(input), init });
    if (String(input).endsWith("/oauth/identity")) {
      return json({
        id: 123,
        username: "collection_example",
        resource_url: "https://api.discogs.com/users/private",
      }, 200, { "x-discogs-ratelimit-remaining": "59" });
    }
    return json({
      pagination: { page: 1, pages: 1, per_page: 100, items: 6 },
      releases,
    }, 200, {
      etag: '"discogs-example"',
      "x-discogs-ratelimit-remaining": "58",
    });
  }, () => discogs.fetchDiscogsSnapshot(credential));

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.cache, "no-store");
    assert.equal(request.init.redirect, "manual");
    assert.equal(request.init.signal instanceof AbortSignal, true);
    assert.match(request.init.headers.Authorization, /^OAuth /);
    assert.equal(request.url.includes("access-token-example"), false);
  }
  assert.equal(result.itemCount, 6);
  assert.equal(result.etag, '"discogs-example"');
  assert.deepEqual(result.publicPayload.totals, {
    physicalItems: 6,
    distinctReleases: 5,
  });
  assert.deepEqual(result.publicPayload.formats, [
    { label: "Box set", count: 2 },
    { label: "Vinyl", count: 1 },
    { label: "CD", count: 1 },
    { label: "Cassette", count: 1 },
    { label: "Other", count: 1 },
  ]);
  assert.equal(result.publicPayload.library.find((item) => item.releaseId === "1").copyCount, 2);
  assert.equal(result.publicPayload.decades.at(-1).label, "Undated");

  const serialized = JSON.stringify(result.publicPayload);
  for (const forbidden of [
    "instance_id",
    "folder_id",
    "date_added",
    "rating",
    "notes",
    "must not survive",
    "thumb",
    "cover_image",
    "resource_url",
    "i.discogs.com",
    "api.discogs.com",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }

  const now = "2026-08-03T12:00:00.000Z";
  const accepted = {
    ...result.publicPayload,
    syncedAt: now,
    freshUntil: "2026-08-03T16:00:00.000Z",
  };
  assert.equal(
    payloadPolicy.validateConnectorPublicPayload("discogs", accepted),
    true,
  );
});

test("Discogs classifies redirects without following credential-bearing requests", async () => {
  let requests = 0;
  await assert.rejects(
    withFetch(
      async () => {
        requests += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.invalid/not-followed" },
        });
      },
      () => discogs.fetchDiscogsSnapshot(credential),
    ),
    (error) =>
      error?.code === "provider_redirect" && error?.httpStatus === 302,
  );
  assert.equal(requests, 1);
});

test("Discogs retries one transient GET failure with a fresh OAuth nonce", async () => {
  const nonces = [];
  let requests = 0;
  const result = await withFetch(async (input, init) => {
    requests += 1;
    const nonce = /oauth_nonce="([^"]+)"/.exec(
      init.headers.Authorization,
    )?.[1];
    nonces.push(nonce);
    if (requests === 1) throw new TypeError("simulated transport failure");
    const url = new URL(String(input));
    if (url.pathname === "/oauth/identity") {
      return json({ username: "collection_example" });
    }
    return json({
      pagination: { page: 1, pages: 1, per_page: 100, items: 0 },
      releases: [],
    });
  }, () => discogs.fetchDiscogsSnapshot(credential));

  assert.equal(result.itemCount, 0);
  assert.equal(requests, 3);
  assert.equal(nonces.every(Boolean), true);
  assert.notEqual(nonces[0], nonces[1]);
});

test("Discogs bounds repeated transport failure to two attempts", async () => {
  let requests = 0;
  await assert.rejects(
    withFetch(
      async () => {
        requests += 1;
        throw new TypeError("simulated repeated transport failure");
      },
      () => discogs.fetchDiscogsSnapshot(credential),
    ),
    (error) => error?.code === "provider_transport",
  );
  assert.equal(requests, 2);
});

test("Discogs bounds a stalled successful response body by the request timeout", async () => {
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  let timersCleared = 0;
  let requests = 0;

  globalThis.setTimeout = (callback, delay, ...arguments_) =>
    nativeSetTimeout(callback, delay === 25_000 ? 5 : delay, ...arguments_);
  globalThis.clearTimeout = (handle) => {
    timersCleared += 1;
    return nativeClearTimeout(handle);
  };

  try {
    await assert.rejects(
      withFetch(
        async (_input, init) => {
          requests += 1;
          const body = new ReadableStream({
            start(controller) {
              init.signal.addEventListener(
                "abort",
                () =>
                  controller.error(
                    new DOMException("The request was aborted.", "AbortError"),
                  ),
                { once: true },
              );
            },
          });
          return new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
        () => discogs.fetchDiscogsSnapshot(credential),
      ),
      (error) =>
        error?.code === "provider_timeout" && error?.httpStatus === null,
    );
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
  }

  assert.equal(requests, 1);
  assert.equal(timersCleared, 1);
});

test("Discogs retries only transient gateway responses", async () => {
  for (const [status, expectedCode] of [
    [401, "reauthorization_required"],
    [429, "rate_limited"],
    [500, "provider_error"],
  ]) {
    let requests = 0;
    await assert.rejects(
      withFetch(
        async () => {
          requests += 1;
          return json({}, status, status === 429 ? { "retry-after": "60" } : {});
        },
        () => discogs.fetchDiscogsSnapshot(credential),
      ),
      (error) => error?.code === expectedCode && error?.httpStatus === status,
    );
    assert.equal(requests, 1);
  }

  let gatewayRequests = 0;
  const recovered = await withFetch(async (input) => {
    gatewayRequests += 1;
    if (gatewayRequests === 1) return json({}, 503);
    const url = new URL(String(input));
    return url.pathname === "/oauth/identity"
      ? json({ username: "collection_example" })
      : json({
          pagination: { page: 1, pages: 1, per_page: 100, items: 0 },
          releases: [],
        });
  }, () => discogs.fetchDiscogsSnapshot(credential));

  assert.equal(recovered.itemCount, 0);
  assert.equal(gatewayRequests, 3);
});

test("Discogs follows pagination sequentially and collapses a duplicate release", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    providerRelease({ id: index + 1 }),
  );
  const requestPages = [];
  const result = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/oauth/identity") {
      return json({ username: "collection_example" });
    }
    const page = Number(url.searchParams.get("page"));
    requestPages.push(page);
    return page === 1
      ? json({
          pagination: { page: 1, pages: 2, per_page: 100, items: 101 },
          releases: firstPage,
        }, 200, { "x-discogs-ratelimit-remaining": "8" })
      : json({
          pagination: { page: 2, pages: 2, per_page: 100, items: 101 },
          releases: [providerRelease({ id: 1 })],
        });
  }, () => discogs.fetchDiscogsSnapshot(credential));

  assert.deepEqual(requestPages, [1, 2]);
  assert.equal(result.itemCount, 101);
  assert.equal(result.publicPayload.library.length, 100);
  assert.equal(result.publicPayload.library.find((item) => item.releaseId === "1").copyCount, 2);
});

test("Discogs bounds cumulative normalized catalog data across pages", async (context) => {
  const denseRelease = (id) => {
    const release = providerRelease({ id });
    release.basic_information.artists = Array.from(
      { length: 16 },
      (_, index) => ({
        name: `${String(index).padStart(2, "0")}-${"a".repeat(437)}`,
        resource_url: `https://api.discogs.com/artists/${id}-${index}`,
      }),
    );
    return release;
  };

  const fetchCatalog = (items) => {
    const pages = Math.ceil(items / 100);
    return withFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/oauth/identity") {
        return json({ username: "collection_example" });
      }
      const page = Number(url.searchParams.get("page"));
      const start = (page - 1) * 100;
      const count = Math.min(100, items - start);
      return json({
        pagination: { page, pages, per_page: 100, items },
        releases: Array.from({ length: count }, (_, index) =>
          denseRelease(start + index + 1),
        ),
      });
    }, () => discogs.fetchDiscogsSnapshot(credential));
  };

  await context.test("accepts a multi-page catalog below the retained budget", async () => {
    const result = await fetchCatalog(200);
    assert.equal(result.itemCount, 200);
    assert.equal(result.publicPayload.library.length, 200);
  });

  await context.test("rejects cumulative retained data that crosses the budget", async () => {
    await assert.rejects(
      fetchCatalog(300),
      (error) => error?.code === "provider_payload_too_large",
    );
  });
});

test("Discogs preserves catalog angle punctuation as safe public text", async () => {
  const result = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/oauth/identity") {
      return json({ username: "collection_example" });
    }
    return json({
      pagination: { page: 1, pages: 1, per_page: 100, items: 1 },
      releases: [
        providerRelease({
          id: 42,
          title: "Love > Logic < Noise",
          artist: "A < B > C",
        }),
      ],
    });
  }, () => discogs.fetchDiscogsSnapshot(credential));

  assert.equal(result.publicPayload.library[0].title, "Love › Logic ‹ Noise");
  assert.deepEqual(result.publicPayload.library[0].artists, ["A ‹ B › C"]);
  const accepted = {
    ...result.publicPayload,
    syncedAt: "2026-08-03T12:00:00.000Z",
    freshUntil: "2026-08-03T16:00:00.000Z",
  };
  assert.equal(
    payloadPolicy.validateConnectorPublicPayload(
      "discogs",
      accepted,
    ),
    true,
  );
});

test("Discogs honors bounded Retry-After delta and HTTP-date values", async () => {
  const now = Date.parse("2026-08-03T12:00:00.000Z");
  assert.equal(discogs.parseDiscogsRetryAfter("120", now), 120);
  assert.equal(
    discogs.parseDiscogsRetryAfter("Mon, 03 Aug 2026 12:02:00 GMT", now),
    120,
  );
  for (const value of [null, "", "0", "-1", "not-a-date", "9999999999"]) {
    assert.equal(discogs.parseDiscogsRetryAfter(value, now), null);
  }

  await assert.rejects(
    withFetch(
      async () => json({}, 429, { "retry-after": "180" }),
      () => discogs.fetchDiscogsSnapshot(credential),
    ),
    (error) =>
      error?.code === "rate_limited" && error?.retryAfterSeconds === 180,
  );
});

test("Discogs fails closed for collection limits, inconsistent pages, and exhausted quota", async (context) => {
  await context.test("more than 5000 physical items", async () => {
    await assert.rejects(
      withFetch(async (input) => {
        const url = new URL(String(input));
        return url.pathname === "/oauth/identity"
          ? json({ username: "collection_example" })
          : json({
              pagination: { page: 1, pages: 51, per_page: 100, items: 5001 },
              releases: [],
            });
      }, () => discogs.fetchDiscogsSnapshot(credential)),
      (error) => error?.code === "collection_too_large",
    );
  });

  await context.test("inconsistent second page", async () => {
    let collectionRequest = 0;
    await assert.rejects(
      withFetch(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/oauth/identity") {
          return json({ username: "collection_example" });
        }
        collectionRequest += 1;
        return collectionRequest === 1
          ? json({
              pagination: { page: 1, pages: 2, per_page: 100, items: 101 },
              releases: Array.from({ length: 100 }, (_, index) =>
                providerRelease({ id: index + 1 }),
              ),
            })
          : json({
              pagination: { page: 2, pages: 3, per_page: 100, items: 101 },
              releases: [providerRelease({ id: 101 })],
            });
      }, () => discogs.fetchDiscogsSnapshot(credential)),
      (error) => error?.code === "provider_schema_changed",
    );
  });

  await context.test("quota exhausted before another page", async () => {
    let requests = 0;
    await assert.rejects(
      withFetch(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/oauth/identity") {
          return json({ username: "collection_example" });
        }
        requests += 1;
        return json({
          pagination: { page: 1, pages: 2, per_page: 100, items: 101 },
          releases: Array.from({ length: 100 }, (_, index) =>
            providerRelease({ id: index + 1 }),
          ),
        }, 200, { "x-discogs-ratelimit-remaining": "0" });
      }, () => discogs.fetchDiscogsSnapshot(credential)),
      (error) => error?.code === "rate_limited" && error?.retryable === true,
    );
    assert.equal(requests, 1);
  });
});

test("Discogs public policy is exact and rejects reconciliation drift or private fields", () => {
  const safe = storedDiscogsPayload();
  assert.equal(payloadPolicy.validateConnectorPublicPayload("discogs", safe), true);
  assert.equal(
    payloadPolicy.normalizeConnectorProfileUrl(
      "discogs",
      "https://www.discogs.com/user/collection_example/collection/",
    ),
    "https://www.discogs.com/user/collection_example/collection",
  );

  const unsafe = [
    { ...safe, username: "standalone-account-name" },
    { ...safe, coverImage: "https://i.discogs.com/example.jpg" },
    { ...safe, totals: { ...safe.totals, physicalItems: 99 } },
    {
      ...safe,
      library: [{ ...safe.library[0], condition: "Mint" }],
    },
    {
      ...safe,
      library: [{ ...safe.library[0], title: "https://example.invalid/track" }],
    },
  ];
  for (const value of unsafe) {
    assert.equal(
      payloadPolicy.validateConnectorPublicPayload("discogs", value),
      false,
    );
  }
});

test("Discogs gallery is server-filtered and exposes no stored library or provider URLs", () => {
  const payload = {
    ...storedDiscogsPayload(),
    totals: { physicalItems: 3, distinctReleases: 2 },
    formats: [
      { label: "Box set", count: 0 },
      { label: "Vinyl", count: 2 },
      { label: "CD", count: 1 },
      { label: "Cassette", count: 0 },
      { label: "Other", count: 0 },
    ],
    decades: [
      { label: "2020s", count: 2 },
      { label: "1990s", count: 1 },
    ],
    formatDecadeMatrix: [
      { format: "Vinyl", decade: "2020s", count: 2 },
      { format: "CD", decade: "1990s", count: 1 },
    ],
    library: [
      storedDiscogsPayload().library[0],
      {
        releaseId: "12",
        title: "Second Release",
        artists: ["Searchable Artist"],
        releaseYear: 1997,
        format: "CD",
        copyCount: 1,
      },
    ],
  };
  assert.equal(payloadPolicy.validateConnectorPublicPayload("discogs", payload), true);

  const projected = gallery.projectConnectorSnapshotForPublic(
    "discogs",
    payload,
    new URLSearchParams({
      q: "searchable",
      format: "cd",
      decade: "1990s",
      sort: "year",
      pageSize: "12",
    }),
  );
  assert.equal(Object.hasOwn(projected, "library"), false);
  assert.deepEqual(projected.gallery.items, [payload.library[1]]);
  assert.equal(projected.gallery.query, "searchable");
  assert.equal(projected.gallery.format, "cd");
  assert.equal(projected.gallery.decade, "1990s");
  assert.equal(projected.gallery.sort, "year");
  assert.equal(JSON.stringify(projected).includes("api.discogs.com"), false);
});

class Statement {
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
    return this.database.first(this);
  }
  all() {
    return this.database.all(this);
  }
  run() {
    return this.database.run(this);
  }
}

class DiscogsD1 {
  constructor() {
    this.settings = new Map();
    this.snapshots = [];
    this.credential = null;
    this.maintenance = null;
    this.statements = [];
  }
  get setting() {
    return this.settings.get("connector.discogs.presentation") ?? null;
  }
  set setting(value) {
    if (value === null) this.settings.delete("connector.discogs.presentation");
    else this.settings.set("connector.discogs.presentation", value);
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
  async first(statement) {
    this.statements.push(statement);
    if (statement.sql.includes("FROM editorial_settings")) {
      return this.settings.get(statement.values[0]) ?? null;
    }
    if (statement.sql.includes("FROM connector_credentials")) {
      return this.credential;
    }
    if (statement.sql.includes("FROM connector_snapshots")) {
      return this.snapshots[0] ?? null;
    }
    if (statement.sql.includes("FROM maintenance_state")) {
      return this.maintenance;
    }
    return null;
  }
  async all(statement) {
    this.statements.push(statement);
    if (statement.sql.includes("FROM connector_snapshots")) {
      return { results: this.snapshots, success: true, meta: {} };
    }
    return { results: [], success: true, meta: {} };
  }
  async run(statement) {
    this.statements.push(statement);
    if (statement.sql.startsWith("INSERT INTO editorial_settings")) {
      const [key, valueJson, , updatedAt] = statement.values;
      this.settings.set(key, { valueJson, updatedAt });
    }
    if (statement.sql.startsWith("DELETE FROM editorial_settings")) {
      this.settings.delete(statement.values[0]);
    }
    if (statement.sql.startsWith("DELETE FROM connector_credentials")) {
      this.credential = null;
    }
    if (statement.sql.startsWith("DELETE FROM connector_snapshots")) {
      this.snapshots = [];
    }
    if (statement.sql.startsWith("INSERT INTO maintenance_state")) {
      const [, detailsJson] = statement.values;
      this.maintenance = { status: "ready", detailsJson };
    }
    if (statement.sql.startsWith("DELETE FROM maintenance_state")) {
      this.maintenance = null;
    }
    return { results: [], success: true, meta: { changes: 1 } };
  }
  async batch(statements) {
    return Promise.all(statements.map((statement) => this.run(statement)));
  }
}

test("Discogs extended-display approval keeps a validated stale catalog available", async () => {
  const database = new DiscogsD1();
  await withRuntimeBindings({ DB: database }, async () => {
    assert.deepEqual(await presentation.getDiscogsPresentationConfig(), {
      status: "ready",
      config: {
        publishCollection: false,
        reviewedAt: null,
        updatedAt: null,
      },
    });
    assert.deepEqual(await presentation.getDiscogsExtendedDisplayApproval(), {
      status: "ready",
      approval: null,
    });
    assert.deepEqual(
      await presentation.saveDiscogsPresentationConfig({
        publishCollection: true,
        acknowledgeNoncommercial: false,
        actorEmail: "owner@example.com",
      }),
      { status: "invalid", reason: "acknowledgement" },
    );
    assert.deepEqual(await repository.getPublicConnectorSnapshot("discogs"), {
      status: "unavailable",
      provider: "discogs",
      reason: "visibility_withheld",
    });

    assert.deepEqual(
      await presentation.saveDiscogsPresentationConfig({
        publishCollection: true,
        acknowledgeNoncommercial: true,
        actorEmail: "owner@example.com",
      }),
      { status: "invalid", reason: "snapshot" },
    );

    const now = new Date();
    const currentPayload = storedDiscogsPayload({
      syncedAt: now.toISOString(),
      freshUntil: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    });
    database.credential = { provider: "discogs", generation: 1 };
    database.snapshots = [{
      status: "ready",
      publicPayloadJson: JSON.stringify(currentPayload),
      fetchedAt: currentPayload.syncedAt,
      freshUntil: currentPayload.freshUntil,
    }];
    const saved = await presentation.saveDiscogsPresentationConfig({
      publishCollection: true,
      acknowledgeNoncommercial: true,
      actorEmail: "owner@example.com",
    });
    assert.equal(saved.status, "saved");

    database.credential.generation = 2;
    assert.deepEqual(await presentation.getDiscogsPresentationConfig(), {
      status: "ready",
      config: {
        publishCollection: false,
        reviewedAt: null,
        updatedAt: saved.config.updatedAt,
      },
    });
    assert.deepEqual(await repository.getPublicConnectorSnapshot("discogs"), {
      status: "unavailable",
      provider: "discogs",
      reason: "visibility_withheld",
    });
    database.credential.generation = 1;

    assert.equal(
      (await repository.getPublicConnectorSnapshot("discogs")).status,
      "ready",
    );

    const expiredPayload = storedDiscogsPayload({
      syncedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000 - 1_000).toISOString(),
      freshUntil: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    });
    database.snapshots = [{
      status: "ready",
      publicPayloadJson: JSON.stringify(expiredPayload),
      fetchedAt: expiredPayload.syncedAt,
      freshUntil: expiredPayload.freshUntil,
    }];
    const grandfatheredStale =
      await repository.getPublicConnectorSnapshot("discogs");
    assert.equal(grandfatheredStale.status, "ready");
    assert.equal(grandfatheredStale.stale, true);
    assert.equal(grandfatheredStale.fetchedAt, expiredPayload.syncedAt);

    const approvedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      .toISOString();
    seedLegacyDiscogsApproval(database, {
      value: { approvedAt },
    });
    const approval = await presentation.getDiscogsExtendedDisplayApproval();
    assert.equal(approval.status, "ready");
    assert.equal(approval.approval?.reference, "owner-permission-reference-2026");

    const stale = await repository.getPublicConnectorSnapshot("discogs");
    assert.equal(stale.status, "ready");
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, expiredPayload.syncedAt);

    const republished = await presentation.saveDiscogsPresentationConfig({
      publishCollection: true,
      acknowledgeNoncommercial: true,
      actorEmail: "owner@example.com",
    });
    assert.equal(republished.status, "saved");

    seedLegacyDiscogsApproval(database, {
      value: {
        approvedAt,
        expiresAt: new Date(now.getTime() - 1_000).toISOString(),
      },
    });
    const expiredLegacyStillGrandfathered =
      await repository.getPublicConnectorSnapshot("discogs");
    assert.equal(expiredLegacyStillGrandfathered.status, "ready");
    assert.equal(expiredLegacyStillGrandfathered.stale, true);

    await repository.deleteConnectorCredential("discogs", "owner@example.com");
    assert.equal(database.setting, null);
    assert.equal(
      database.settings.has("connector.discogs.extended_display_approval"),
      false,
    );
    assert.equal(database.credential, null);
    assert.equal(database.snapshots.length, 0);
  });
});

test("Discogs extended-display approval rejects malformed protected records", async () => {
  const database = new DiscogsD1();
  await withRuntimeBindings({ DB: database }, async () => {
    const approvedAt = new Date(Date.now() - 60_000).toISOString();
    for (const input of [
      {
        provider: "spotify",
        reference: "permission-reference",
        approvedAt,
        expiresAt: null,
        enabled: true,
      },
      {
        provider: "discogs",
        reference: "permission-reference\nunsafe",
        approvedAt,
        expiresAt: null,
        enabled: true,
      },
      {
        provider: "discogs",
        reference: "permission-reference",
        approvedAt: "not-a-date",
        expiresAt: null,
        enabled: true,
      },
      {
        provider: "discogs",
        reference: "permission-reference",
        approvedAt,
        expiresAt: new Date(Date.parse(approvedAt) - 1).toISOString(),
        enabled: true,
      },
    ]) {
      seedLegacyDiscogsApproval(database, { value: input });
      assert.deepEqual(await presentation.getDiscogsExtendedDisplayApproval(), {
        status: "setup_required",
      });
    }
  });
});

test("Discogs Retry-After state blocks manual and retired automatic provider calls", async () => {
  const database = new DiscogsD1();
  const now = Date.now();
  const notBefore = await retryState.recordDiscogsRetryAfter(
    database,
    120,
    now,
  );
  assert.equal(notBefore, new Date(now + 120_000).toISOString());
  assert.equal(
    await retryState.discogsRetryNotBefore(database, now),
    notBefore,
  );

  assert.deepEqual(
    await refreshRepository.refreshConnectorUsingDatabase(
      database,
      "discogs",
      "manual",
      "owner@example.com",
    ),
    {
      status: "failed",
      provider: "discogs",
      code: "rate_limited",
      retryable: true,
      retryNotBefore: notBefore,
    },
  );
  assert.deepEqual(
    await refreshRepository.refreshConnectorUsingDatabase(
      database,
      "discogs",
      "stale_revalidate",
      null,
    ),
    { status: "not_due", provider: "discogs" },
  );
  assert.equal(
    await retryState.discogsRetryNotBefore(database, now + 121_000),
    null,
  );
  await retryState.clearDiscogsRetry(database);
  assert.equal(database.maintenance, null);
});

test("Discogs retry controls reconcile server and local deadlines", () => {
  const now = Date.parse("2026-08-03T16:00:00.000Z");
  const serverDeadline = "2026-08-03T16:30:00.000Z";
  const responseDeadline = "2026-08-03T17:00:00.000Z";

  assert.deepEqual(
    retryUi.retryDeadlineState(serverDeadline, responseDeadline, now),
    {
      retryNotBefore: responseDeadline,
      retryTimestamp: Date.parse(responseDeadline),
      blocked: true,
    },
    "a newer deadline returned by refresh must win",
  );
  assert.equal(
    retryUi.retryDeadlineState(
      "2026-08-03T18:00:00.000Z",
      responseDeadline,
      now,
    ).retryNotBefore,
    "2026-08-03T18:00:00.000Z",
    "a newer server deadline from RSC reconciliation must win",
  );
  assert.equal(
    retryUi.retryDeadlineState(serverDeadline, null, Date.parse(serverDeadline))
      .blocked,
    false,
    "the control must re-enable when the deadline expires",
  );
  assert.deepEqual(
    retryUi.retryDeadlineState("not-a-date", null, now),
    {
      retryNotBefore: null,
      retryTimestamp: Number.NaN,
      blocked: false,
    },
    "malformed deadlines must not trap the owner",
  );
});

test("Discogs manual refresh respects the four-hour provider window", async () => {
  const database = new DiscogsD1();
  const fetchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  database.snapshots = [{
    status: "ready",
    fetchedAt,
  }];

  assert.deepEqual(
    await refreshRepository.refreshConnectorUsingDatabase(
      database,
      "discogs",
      "manual",
      "owner@example.com",
    ),
    {
      status: "not_due",
      provider: "discogs",
      retryNotBefore: new Date(
        Date.parse(fetchedAt) + 4 * 60 * 60 * 1000,
      ).toISOString(),
    },
  );
  assert.equal(
    database.statements.some((statement) =>
      statement.sql.includes("FROM connector_credentials"),
    ),
    false,
  );
});

test("connector reads and cron cannot initiate provider collection synchronization", async () => {
  const [
    refreshSource,
    workerSource,
    credentialSource,
    routeSource,
    approvalRouteSource,
    refreshRouteSource,
    publicRouteSource,
    spotifyRouteSource,
    stravaRouteSource,
    myAnimeListCallbackSource,
    spotifyCallbackSource,
    discogsCallbackSource,
  ] = await Promise.all([
    readFile(new URL("../lib/server/connectors/repository-refresh.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/connectors/repository-credentials.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/http/discogs-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/http/connector-publication-approvals.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/http/connector-refresh-response.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/[provider]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/spotify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/strava/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/myanimelist/oauth/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/spotify/oauth/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/discogs/oauth/callback/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(refreshSource, /DISCOGS_FRESHNESS_WINDOW_MS = 4 \* 60 \* 60 \* 1000/);
  assert.match(refreshSource, /trigger !== "manual"/);
  assert.match(refreshSource, /function retainedSnapshotCount[\s\S]*return 2;/);
  assert.match(workerSource, /if \(!env\.DB\) return;/);
  assert.match(workerSource, /const db = env\.DB;/);
  assert.doesNotMatch(workerSource, /refreshDiscogsWhenDue|refreshConnector/);
  assert.match(credentialSource, /DISCOGS_PRESENTATION_SETTING_KEY/);
  assert.match(routeSource, /rejectCrossOriginWrite\(request\)[\s\S]*authorizeOwnerApi\(\)[\s\S]*readBoundedJsonBody/);
  assert.doesNotMatch(routeSource, /saveDiscogsExtendedDisplayApproval/);
  assert.match(approvalRouteSource, /rejectCrossOriginWrite\(request\)[\s\S]*authorizeOwnerApi\(\)[\s\S]*readBoundedJsonBody/);
  assert.match(approvalRouteSource, /saveConnectorPublicationApproval/);
  assert.match(refreshSource, /retryNotBefore: notBefore/);
  assert.match(refreshRouteSource, /"retry-after": String\(retryAfter\)/);
  for (const source of [publicRouteSource, spotifyRouteSource, stravaRouteSource]) {
    assert.doesNotMatch(source, /refreshConnector|getRequestExecutionContext|verifyStravaEmbed/);
  }
  for (const source of [
    credentialSource,
    myAnimeListCallbackSource,
    spotifyCallbackSource,
    discogsCallbackSource,
  ]) {
    assert.doesNotMatch(source, /refreshConnector\(/);
  }
});
