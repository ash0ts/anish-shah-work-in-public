import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [
  {
    fetchSteamSnapshot,
    normalizeSteamApiKey,
    normalizeSteamId,
  },
  { validateConnectorPublicPayload },
  { ConnectorFetchError },
] = await Promise.all([
  import("../lib/server/connectors/steam.ts"),
  import("../lib/server/connectors/public-payload-policy.ts"),
  import("../lib/server/connectors/types.ts"),
]);

const API_KEY = "00000000000000000000000000000001";
const STEAM_ID = "76561198000000000";
const syncedAt = "2026-07-30T18:00:00.000Z";
const freshUntil = "2026-07-31T06:00:00.000Z";

async function fixture(name) {
  return JSON.parse(
    await readFile(
      new URL(`./fixtures/connectors/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

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

async function expectConnectorError(action, expected) {
  await assert.rejects(action, (error) => {
    assert(error instanceof ConnectorFetchError);
    assert.equal(error.code, expected.code);
    assert.equal(error.httpStatus, expected.httpStatus ?? null);
    assert.equal(error.retryable, expected.retryable ?? false);
    return true;
  });
}

test("Steam credentials are strictly normalized before any provider request", () => {
  assert.equal(normalizeSteamApiKey(` ${API_KEY.toUpperCase()} `), API_KEY.toUpperCase());
  assert.equal(normalizeSteamId(` ${STEAM_ID} `), STEAM_ID);

  for (const value of ["", "short", `${API_KEY}0`, "g".repeat(32)]) {
    assert.equal(normalizeSteamApiKey(value), "");
  }
  for (const value of ["", "1234", `${STEAM_ID}0`, `-${STEAM_ID.slice(1)}`]) {
    assert.equal(normalizeSteamId(value), "");
  }
});

test("Steam success fixture is normalized, rounded, bounded, and secret-free", async () => {
  const success = await fixture("steam-success");
  const responses = [
    jsonResponse(success.playerSummary),
    jsonResponse(success.ownedGames),
    jsonResponse(success.recentGames),
  ];
  const requests = [];

  const result = await withFetch(async (input, init) => {
    requests.push({ url: String(input), init });
    return responses.shift();
  }, () => fetchSteamSnapshot({ apiKey: API_KEY, steamId: STEAM_ID }));

  assert.equal(requests.length, 3);
  for (const request of requests) {
    const url = new URL(request.url);
    assert.equal(url.origin, "https://api.steampowered.com");
    assert.equal(url.searchParams.has("key"), false);
    assert.equal(url.search.includes(API_KEY), false);
    assert.equal(request.init.headers["x-webapi-key"], API_KEY);
  }

  assert.equal(result.itemCount, 10);
  assert.deepEqual(result.publicPayload, {
    provider: "steam",
    profileUrl: `https://steamcommunity.com/profiles/${STEAM_ID}`,
    coverage: "Public Steam game details returned at sync",
    totals: {
      publicGameCount: 10,
      playedGameCount: 9,
      totalHoursRounded: 104,
    },
    topPlayed: [
      { appId: "104", title: "Delta", hoursRounded: 50 },
      { appId: "107", title: "Eta", hoursRounded: 20 },
      { appId: "103", title: "Gamma", hoursRounded: 10 },
      { appId: "109", title: "Iota", hoursRounded: 8 },
      { appId: "110", title: "Kappa", hoursRounded: 6 },
      { appId: "108", title: "Theta", hoursRounded: 4 },
      { appId: "106", title: "Zeta", hoursRounded: 3 },
      { appId: "101", title: "Alpha", hoursRounded: 2 },
    ],
    recent: [
      {
        appId: "101",
        title: "Alpha",
        recentHoursRounded: 2,
        totalHoursRounded: 2,
      },
      {
        appId: "102",
        title: "Beta",
        recentHoursRounded: 1,
        totalHoursRounded: 0,
      },
      {
        appId: "103",
        title: "Gamma",
        recentHoursRounded: 0,
        totalHoursRounded: 10,
      },
      {
        appId: "104",
        title: "Delta",
        recentHoursRounded: 3,
        totalHoursRounded: 50,
      },
      {
        appId: "105",
        title: "Epsilon",
        recentHoursRounded: 1,
        totalHoursRounded: 1,
      },
      {
        appId: "106",
        title: "Zeta",
        recentHoursRounded: 2,
        totalHoursRounded: 3,
      },
      {
        appId: "107",
        title: "Eta",
        recentHoursRounded: 4,
        totalHoursRounded: 20,
      },
      {
        appId: "108",
        title: "Theta",
        recentHoursRounded: 0,
        totalHoursRounded: 4,
      },
    ],
  });

  const publicPayload = {
    ...result.publicPayload,
    syncedAt,
    freshUntil,
  };
  assert.equal(validateConnectorPublicPayload("steam", publicPayload), true);
  assert.equal(
    validateConnectorPublicPayload("steam", {
      ...publicPayload,
      apiKey: API_KEY,
    }),
    false,
  );
  assert.equal(
    validateConnectorPublicPayload("steam", {
      ...publicPayload,
      steamId: STEAM_ID,
    }),
    false,
  );
  assert.equal(Object.hasOwn(result.publicPayload, "steamId"), false);
  assert.equal(JSON.stringify(result.publicPayload).includes(API_KEY), false);
  assert.equal(result.publicPayload.topPlayed.length, 8);
  assert.equal(result.publicPayload.recent.length, 8);
});

test("Steam rejects invalid credentials before making a request", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return jsonResponse({});
  }, async () => {
    await expectConnectorError(
      () => fetchSteamSnapshot({ apiKey: "not-a-key", steamId: STEAM_ID }),
      { code: "credential_invalid" },
    );
    await expectConnectorError(
      () => fetchSteamSnapshot({ apiKey: API_KEY, steamId: "1234" }),
      { code: "credential_invalid" },
    );
  });
  assert.equal(calls, 0);
});

test("Steam classifies authorization, rate-limit, and provider failures", async (context) => {
  for (const scenario of [
    {
      name: "401",
      status: 401,
      expected: {
        code: "credential_expired",
        httpStatus: 401,
        retryable: false,
      },
    },
    {
      name: "403",
      status: 403,
      expected: {
        code: "credential_expired",
        httpStatus: 403,
        retryable: false,
      },
    },
    {
      name: "429",
      status: 429,
      expected: {
        code: "rate_limited",
        httpStatus: 429,
        retryable: true,
      },
    },
    {
      name: "500",
      status: 500,
      expected: {
        code: "provider_error",
        httpStatus: 500,
        retryable: true,
      },
    },
  ]) {
    await context.test(scenario.name, async () => {
      await withFetch(
        async () => jsonResponse({ error: scenario.name }, { status: scenario.status }),
        () =>
          expectConnectorError(
            () => fetchSteamSnapshot({ apiKey: API_KEY, steamId: STEAM_ID }),
            scenario.expected,
          ),
      );
    });
  }
});

test("Steam distinguishes private libraries from malformed provider data", async (context) => {
  const privateLibrary = await fixture("steam-private-library");

  await context.test("private game details", async () => {
    const responses = [
      jsonResponse(privateLibrary.playerSummary),
      jsonResponse(privateLibrary.ownedGames),
    ];
    await withFetch(
      async () => responses.shift(),
      () =>
        expectConnectorError(
          () => fetchSteamSnapshot({ apiKey: API_KEY, steamId: STEAM_ID }),
          { code: "visibility_unavailable" },
        ),
    );
  });

  await context.test("malformed owned-games collection", async () => {
    const responses = [
      jsonResponse(privateLibrary.playerSummary),
      jsonResponse({ response: { game_count: 1, games: {} } }),
    ];
    await withFetch(
      async () => responses.shift(),
      () =>
        expectConnectorError(
          () => fetchSteamSnapshot({ apiKey: API_KEY, steamId: STEAM_ID }),
          { code: "provider_schema_changed" },
        ),
    );
  });

  await context.test("malformed recent-games collection", async () => {
    const responses = [
      jsonResponse(privateLibrary.playerSummary),
      jsonResponse({ response: { game_count: 0, games: [] } }),
      jsonResponse({ response: { games: {} } }),
    ];
    await withFetch(
      async () => responses.shift(),
      () =>
        expectConnectorError(
          () => fetchSteamSnapshot({ apiKey: API_KEY, steamId: STEAM_ID }),
          { code: "provider_schema_changed" },
        ),
    );
  });

  await context.test("non-JSON response", async () => {
    await withFetch(
      async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      () =>
        expectConnectorError(
          () => fetchSteamSnapshot({ apiKey: API_KEY, steamId: STEAM_ID }),
          { code: "provider_schema_changed" },
        ),
    );
  });
});

test("Steam rejects an oversized provider response before parsing it", async () => {
  await withFetch(
    async () =>
      jsonResponse(
        {},
        {
          headers: { "content-length": "5000001" },
        },
      ),
    () =>
      expectConnectorError(
        () => fetchSteamSnapshot({ apiKey: API_KEY, steamId: STEAM_ID }),
        { code: "provider_payload_too_large" },
      ),
  );
});
