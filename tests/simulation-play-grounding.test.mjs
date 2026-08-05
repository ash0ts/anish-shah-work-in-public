import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [groundingModule, providerModule] = await Promise.all([
  import("../lib/server/simulation/play-grounding.ts"),
  import("../lib/server/simulation/provider.ts"),
]);

const {
  SIMULATION_PLAY_PROMPT_CHARACTER_LIMIT,
  SIMULATION_PLAY_PROMPT_FACET_LIMIT,
  SIMULATION_PLAY_PROMPT_ITEM_LIMIT,
  resolveSimulationPlayGrounding,
} = groundingModule;
const { buildSimulationGroundedPrompt } = providerModule;

const NOW = new Date("2026-08-03T12:00:00.000Z");
const FUTURE = "2026-08-04T12:00:00.000Z";

function readySnapshot(provider, payload, overrides = {}) {
  return {
    status: "ready",
    provider,
    payload: { provider, ...payload },
    fetchedAt: "2026-08-03T11:00:00.000Z",
    freshUntil: FUTURE,
    stale: false,
    ...overrides,
  };
}

function unavailableStrava() {
  return Promise.resolve({
    status: "unavailable",
    reason: "not_configured",
  });
}

test("Play grounding gates before retrieval and never loads outside Act III", async () => {
  const calls = [];
  const loaders = {
    connectorSnapshot: async (provider) => {
      calls.push(`connector:${provider}`);
      return readySnapshot(provider, { library: [] });
    },
    stravaConfig: async () => {
      calls.push("strava");
      return { status: "unavailable", reason: "not_configured" };
    },
  };

  assert.equal(
    await resolveSimulationPlayGrounding({
      sceneId: "act-3",
      provider: "spotify",
      approvedForGameAndModel: false,
      now: NOW,
      loaders,
    }),
    null,
  );
  assert.equal(
    await resolveSimulationPlayGrounding({
      sceneId: "act-2",
      provider: "spotify",
      approvedForGameAndModel: true,
      now: NOW,
      loaders,
    }),
    null,
  );
  assert.deepEqual(calls, []);
});

test("one approved action reads only its selected provider", async () => {
  const connectorCalls = [];
  let stravaCalls = 0;
  const tracks = Array.from({ length: 12 }, (_, index) => ({
    id: `not-projected-${index}`,
    title: `Track ${String(index).padStart(2, "0")}`,
    artists: [{ id: `hidden-artist-${index}`, name: `Artist ${index}` }],
    album: {
      id: `hidden-album-${index}`,
      title: `Album ${index}`,
      artwork: { kind: "spotify-cover", assetKey: `private-${index}` },
    },
    durationMs: 180_000,
    explicit: false,
  }));
  const result = await resolveSimulationPlayGrounding({
    sceneId: "act-3",
    provider: "spotify",
    approvedForGameAndModel: true,
    now: NOW,
    loaders: {
      connectorSnapshot: async (provider) => {
        connectorCalls.push(provider);
        return readySnapshot(provider, {
          profileUrl: "https://open.spotify.com/user/private-profile-id",
          windows: {
            short_term: { tracks },
            medium_term: { tracks },
            long_term: { tracks },
          },
          accessToken: "must-never-project",
        });
      },
      stravaConfig: async () => {
        stravaCalls += 1;
        return { status: "unavailable", reason: "not_configured" };
      },
    },
  });

  assert.deepEqual(connectorCalls, ["spotify"]);
  assert.equal(stravaCalls, 0);
  assert.equal(result?.provider, "spotify");
  assert.equal(result?.items.length, 12);
});

test("full public collection is deterministically reduced to strict safe caps", async () => {
  const library = Array.from({ length: 80 }, (_, index) => ({
    id: String(900_000 + index),
    title:
      index === 40
        ? "Injected https://private.example/token profile@example.com signal"
        : `Signal ${String(index).padStart(3, "0")} ${"x".repeat(180)}`,
    startDate: "2001-01-01",
    releaseYear: 2001,
    genres: ["Science Fiction", "Systems"],
    status: "Completed",
    score: 10,
    episodesWatched: 9_999,
    updatedAt: FUTURE,
    artwork: { kind: "mal-cover", assetKey: `/private/${index}` },
    remoteUrl: `https://provider.example/${index}`,
    accountIdentifier: `private-${index}`,
  }));
  const result = await resolveSimulationPlayGrounding({
    sceneId: "act-3",
    provider: "myanimelist",
    approvedForGameAndModel: true,
    now: NOW,
    loaders: {
      connectorSnapshot: async (provider) =>
        readySnapshot(provider, {
          profileUrl: "https://myanimelist.net/profile/private-owner",
          status: [{ label: "Completed", count: 80 }],
          genres: [
            { label: "Science Fiction", count: 80 },
            { label: "Systems", count: 79 },
            { label: "Long tail", count: 1 },
          ],
          eras: [{ label: "2000s", count: 80 }],
          library,
          secret: "not-for-model-context",
        }),
      stravaConfig: unavailableStrava,
    },
  });

  assert.ok(result);
  assert.ok(result.items.length <= SIMULATION_PLAY_PROMPT_ITEM_LIMIT);
  assert.ok(result.facets.length <= SIMULATION_PLAY_PROMPT_FACET_LIMIT);
  assert.ok(
    JSON.stringify(result).length <= SIMULATION_PLAY_PROMPT_CHARACTER_LIMIT,
  );
  assert.equal(result.items[0].title.startsWith("Injected signal"), true);
  assert.equal(result.items.at(-1).title.startsWith("Signal 079"), true);

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "https://",
    "profile@example.com",
    "profileUrl",
    "private-owner",
    "assetKey",
    "artwork",
    "accountIdentifier",
    "remoteUrl",
    "episodesWatched",
    "score",
    "secret",
    "900000",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "i"), forbidden);
  }
});

test("stale, expired, missing, and empty snapshots remain generic doorways", async () => {
  for (const snapshot of [
    { status: "unavailable", provider: "hardcover", reason: "never_synced" },
    readySnapshot("hardcover", { library: [{ title: "Book", status: "Read" }] }, { stale: true }),
    readySnapshot(
      "hardcover",
      { library: [{ title: "Book", status: "Read" }] },
      { freshUntil: "2026-08-03T11:59:59.000Z" },
    ),
    readySnapshot("hardcover", { library: [] }),
  ]) {
    const result = await resolveSimulationPlayGrounding({
      sceneId: "act-3",
      provider: "hardcover",
      approvedForGameAndModel: true,
      now: NOW,
      loaders: {
        connectorSnapshot: async () => snapshot,
        stravaConfig: unavailableStrava,
      },
    });
    assert.equal(result, null);
  }
});

test("Strava uses only its public config and strips every URL and identifier", async () => {
  let connectorCalls = 0;
  let stravaCalls = 0;
  const result = await resolveSimulationPlayGrounding({
    sceneId: "act-3",
    provider: "strava",
    approvedForGameAndModel: true,
    now: NOW,
    loaders: {
      connectorSnapshot: async () => {
        connectorCalls += 1;
        throw new Error("wrong_loader");
      },
      stravaConfig: async () => {
        stravaCalls += 1;
        return {
          status: "ready",
          config: {
            provider: "strava",
            profileUrl: "https://www.strava.com/athletes/37597587",
            embed: {
              kind: "profile_feed",
              embedUrl:
                "https://www.strava.com/athletes/37597587/latest-rides/private-token",
              checkedAt: "2026-08-03T11:00:00.000Z",
            },
            embedStatus: "available",
            updatedAt: "2026-08-03T11:00:00.000Z",
          },
        };
      },
    },
  });

  assert.equal(connectorCalls, 0);
  assert.equal(stravaCalls, 1);
  assert.deepEqual(result, {
    provider: "strava",
    source: "current_public_config",
    facets: ["Recent public activity feed"],
    items: [],
  });
  assert.doesNotMatch(JSON.stringify(result), /37597587|https:|embedUrl|profileUrl/);
});

test("model prompt receives only the bounded public collection projection", () => {
  const summary = {
    provider: "discogs",
    source: "current_public_snapshot",
    facets: ["Vinyl", "1990s"],
    items: [{ title: "A record", descriptors: ["Artist", "Vinyl"] }],
  };
  const prompt = buildSimulationGroundedPrompt({
    sceneId: "act-3",
    actionId: "collect",
    facts: [],
    allowedEntityIds: [],
    visitorSignals: [],
    curiosity: "surprise",
    providerGrounding: {
      provider: "discogs",
      label: "Collect",
      approvedForModel: true,
      summary,
    },
  });
  const parsed = JSON.parse(prompt);
  assert.deepEqual(parsed.playDoorway, {
    label: "Collect",
    publicCollection: summary,
  });
  assert.equal(parsed.actionId, "collect");
  assert.equal("provider" in parsed.playDoorway, false);

  const generic = JSON.parse(
    buildSimulationGroundedPrompt({
      sceneId: "act-3",
      actionId: "collect",
      facts: [],
      allowedEntityIds: [],
      visitorSignals: [],
      curiosity: "surprise",
      providerGrounding: {
        provider: "discogs",
        label: "Collect",
        approvedForModel: false,
        summary: null,
      },
    }),
  );
  assert.equal(generic.actionId, "play-doorway");
  assert.equal(generic.playDoorway, null);
});
