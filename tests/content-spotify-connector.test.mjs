import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [oauth, spotify, artwork, gallery, payloadPolicy] = await Promise.all([
  import("../lib/server/connectors/spotify-oauth.ts"),
  import("../lib/server/connectors/spotify.ts"),
  import("../lib/server/connectors/artwork.ts"),
  import("../lib/server/connectors/public-gallery.ts"),
  import("../lib/server/connectors/public-payload-policy.ts"),
]);
const { normalizeSpotifyFallbackEmbed } = await import(
  "../lib/server/connectors/spotify-presentation.ts"
);
const {
  getSpotifyPresentationConfig,
  saveSpotifyPresentationConfig,
} = await import("../lib/server/connectors/spotify-presentation.ts");
const { getPublicConnectorSnapshot } = await import(
  "../lib/server/connectors/repository.ts"
);

const trackId = "1".repeat(22);
const artistId = "2".repeat(22);
const albumId = "3".repeat(22);
const coverKey = "a".repeat(40);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
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

class PresentationD1 {
  constructor() {
    this.setting = null;
    this.snapshots = [];
    this.audits = [];
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
  async first(statement) {
    if (statement.sql.includes("FROM editorial_settings")) {
      return this.setting;
    }
    return null;
  }
  async all(statement) {
    if (statement.sql.includes("FROM connector_snapshots")) {
      return { results: this.snapshots, success: true, meta: {} };
    }
    return { results: [], success: true, meta: {} };
  }
  async run(statement) {
    if (statement.sql.startsWith("INSERT INTO editorial_settings")) {
      const [, valueJson, updatedByEmail, updatedAt] = statement.values;
      this.setting = { valueJson, updatedByEmail, updatedAt };
    }
    if (statement.sql.startsWith("INSERT INTO audit_log")) {
      this.audits.push(structuredClone(statement.values));
    }
    return { results: [], success: true, meta: { changes: 1 } };
  }
  async batch(statements) {
    return Promise.all(statements.map((statement) => this.run(statement)));
  }
}

function providerTrack(id = trackId) {
  return {
    id,
    name: "A precise track",
    artists: [{ id: artistId, name: "A precise artist" }],
    album: {
      id: albumId,
      name: "A precise album",
      release_date: "2024-01-02",
      images: [
        {
          url: `https://i.scdn.co/image/${coverKey}`,
          width: 640,
          height: 640,
        },
      ],
    },
    duration_ms: 187_000,
    explicit: false,
    popularity: 99,
    preview_url: "https://example.invalid/must-not-survive.mp3",
    external_urls: { spotify: "https://example.invalid/must-not-survive" },
  };
}

test("Spotify OAuth uses S256 PKCE and a 127.0.0.1 local callback", async () => {
  const state = oauth.createSpotifyOAuthState();
  const verifier = oauth.createSpotifyPkceVerifier();
  const challenge = await oauth.createSpotifyPkceChallenge(verifier);
  const callback = oauth.resolveSpotifyCallbackUrl(
    "http://localhost:3000/api/studio/connectors/spotify/oauth/start",
    "http://localhost:3000",
    "development",
  );
  assert.equal(
    callback,
    "http://127.0.0.1:3000/api/connectors/spotify/oauth/callback",
  );
  assert.match(state, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);

  const authorization = new URL(
    oauth.buildSpotifyAuthorizationUrl({
      clientId: "spotify-client-id",
      codeChallenge: challenge,
      redirectUri: callback,
      state,
    }),
  );
  assert.equal(authorization.origin, "https://accounts.spotify.com");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("code_challenge"), challenge);
  assert.equal(
    authorization.searchParams.get("scope"),
    "user-top-read user-read-private",
  );
  assert.equal(authorization.toString().includes("client-secret"), false);

  assert.equal(
    oauth.resolveSpotifyCallbackUrl(
      "http://localhost:3001/api/studio/connectors/spotify/oauth/start",
      "http://localhost:3000",
      "development",
    ),
    null,
  );
  assert.equal(
    oauth.resolveSpotifyCallbackUrl(
      "http://127.0.0.1:3000/api/connectors/spotify/oauth/callback",
      "http://localhost:3000",
      "development",
    ),
    callback,
  );
});

test("Spotify token exchange keeps secrets in server authorization headers", async () => {
  let captured;
  const credential = await withFetch(async (url, init) => {
    captured = { url: String(url), init };
    return json({
      access_token: "spotify-access-token",
      refresh_token: "spotify-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "user-top-read user-read-private",
      scope: "user-top-read user-read-private",
    });
  }, () =>
    oauth.exchangeSpotifyAuthorizationCode({
      clientId: "spotify-client-id",
      clientSecret: "spotify-client-secret",
      authorizationCode: "spotify-authorization-code",
      codeVerifier: "v".repeat(64),
      redirectUri:
        "http://127.0.0.1:3000/api/connectors/spotify/oauth/callback",
      now: Date.parse("2026-08-02T12:00:00.000Z"),
    }),
  );
  assert.equal(captured.url, oauth.SPOTIFY_TOKEN_ENDPOINT);
  assert.match(captured.init.headers.Authorization, /^Basic /);
  assert.equal(captured.init.body.includes("spotify-client-secret"), false);
  assert.equal(captured.init.body.includes("code_verifier="), true);
  assert.equal(credential.accessToken, "spotify-access-token");
  assert.equal(credential.refreshToken, "spotify-refresh-token");
  assert.deepEqual(credential.scopes, ["user-top-read", "user-read-private"]);
});

test("Spotify rejects non-Bearer grants and authorization missing required scopes", async () => {
  const exchange = (body) =>
    withFetch(
      async () => json(body),
      () =>
        oauth.exchangeSpotifyAuthorizationCode({
          clientId: "spotify-client-id",
          clientSecret: "spotify-client-secret",
          authorizationCode: "spotify-authorization-code",
          codeVerifier: "v".repeat(64),
          redirectUri:
            "http://127.0.0.1:3000/api/connectors/spotify/oauth/callback",
        }),
    );

  await assert.rejects(
    exchange({
      access_token: "spotify-access-token",
      refresh_token: "spotify-refresh-token",
      expires_in: 3600,
      token_type: "MAC",
      scope: "user-top-read user-read-private",
    }),
    (error) => error?.code === "oauth_token_response_invalid",
  );
  await assert.rejects(
    exchange({
      access_token: "spotify-access-token",
      refresh_token: "spotify-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "user-top-read",
    }),
    (error) => error?.code === "oauth_token_response_invalid",
  );
});

test("Spotify refresh retains the granted scopes when the provider omits scope", async () => {
  const original = {
    kind: "oauth",
    clientId: "spotify-client-id",
    clientSecret: "spotify-client-secret",
    accessToken: "spotify-access-token",
    refreshToken: "spotify-refresh-token",
    accessTokenExpiresAt: "2026-08-02T13:00:00.000Z",
    scopes: ["user-top-read", "user-read-private"],
  };
  const refreshed = await withFetch(
    async () =>
      json({
        access_token: "spotify-replacement-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    () =>
      oauth.refreshSpotifyOAuthCredential(
        original,
        Date.parse("2026-08-02T12:30:00.000Z"),
      ),
  );
  assert.equal(refreshed.refreshToken, original.refreshToken);
  assert.deepEqual(refreshed.scopes, original.scopes);
});

test("Spotify token and API readers reject declared oversized responses", async () => {
  await assert.rejects(
    withFetch(
      async () =>
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": String(64 * 1024 + 1),
          },
        }),
      () =>
        oauth.exchangeSpotifyAuthorizationCode({
          clientId: "spotify-client-id",
          clientSecret: "spotify-client-secret",
          authorizationCode: "spotify-authorization-code",
          codeVerifier: "v".repeat(64),
          redirectUri:
            "http://127.0.0.1:3000/api/connectors/spotify/oauth/callback",
        }),
    ),
    (error) => error?.code === "oauth_token_response_invalid",
  );

  await assert.rejects(
    withFetch(
      async () =>
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": "1000001",
          },
        }),
      () =>
        spotify.fetchSpotifySnapshot({
          kind: "oauth",
          clientId: "spotify-client-id",
          clientSecret: "spotify-client-secret",
          accessToken: "spotify-access-token",
          refreshToken: "spotify-refresh-token",
          accessTokenExpiresAt: "2026-08-02T13:00:00.000Z",
          scopes: ["user-top-read", "user-read-private"],
        }),
    ),
    (error) => error?.code === "provider_payload_too_large",
  );
});

test("Spotify rejects non-JSON success bodies from token and API endpoints", async () => {
  await assert.rejects(
    withFetch(
      async () =>
        new Response("not json", {
          headers: { "content-type": "text/plain" },
        }),
      () =>
        oauth.exchangeSpotifyAuthorizationCode({
          clientId: "spotify-client-id",
          clientSecret: "spotify-client-secret",
          authorizationCode: "spotify-authorization-code",
          codeVerifier: "v".repeat(64),
          redirectUri:
            "http://127.0.0.1:3000/api/connectors/spotify/oauth/callback",
        }),
    ),
    (error) => error?.code === "oauth_token_response_invalid",
  );
  await assert.rejects(
    withFetch(
      async () =>
        new Response("not json", {
          headers: { "content-type": "text/plain" },
        }),
      () =>
        spotify.fetchSpotifySnapshot({
          kind: "oauth",
          clientId: "spotify-client-id",
          clientSecret: "spotify-client-secret",
          accessToken: "spotify-access-token",
          refreshToken: "spotify-refresh-token",
          accessTokenExpiresAt: "2026-08-02T13:00:00.000Z",
          scopes: ["user-top-read", "user-read-private"],
        }),
    ),
    (error) => error?.code === "provider_schema_changed",
  );
});

test("Spotify snapshot preserves returned rank and drops forbidden provider fields", async () => {
  const result = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/me") {
      return json({
        id: "4".repeat(22),
        country: "US",
        product: "premium",
        email: "private@example.com",
      });
    }
    const range = url.searchParams.get("time_range");
    assert(spotify.SPOTIFY_TIME_RANGES.includes(range));
    return json({ items: [providerTrack()] });
  }, () =>
    spotify.fetchSpotifySnapshot({
      kind: "oauth",
      clientId: "spotify-client-id",
      clientSecret: "spotify-client-secret",
      accessToken: "spotify-access-token",
      refreshToken: "spotify-refresh-token",
      accessTokenExpiresAt: "2026-08-02T13:00:00.000Z",
      scopes: ["user-top-read", "user-read-private"],
    }),
  );

  assert.equal(result.itemCount, 3);
  assert.equal(result.publicPayload.windows.short_term.tracks[0].position, 1);
  assert.deepEqual(
    result.publicPayload.windows.short_term.tracks[0].album.artwork,
    { kind: "spotify-cover", assetKey: `/image/${coverKey}` },
  );
  const serialized = JSON.stringify(result.publicPayload);
  for (const forbidden of [
    "preview_url",
    "popularity",
    "external_urls",
    "private@example.com",
    '"country"',
    '"product"',
    "i.scdn.co",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(
    payloadPolicy.validateConnectorPublicPayload(
      "spotify",
      {
        ...result.publicPayload,
        syncedAt: "2026-08-02T12:00:00.000Z",
        freshUntil: "2026-08-03T00:00:00.000Z",
      },
    ),
    true,
  );

  const projected = gallery.projectConnectorSnapshotForPublic(
    "spotify",
    result.publicPayload,
    new URLSearchParams(),
  );
  assert.deepEqual(
    projected.windows.short_term.tracks[0].album.artwork,
    {
      src: `/api/connector-artwork/spotify/${trackId}`,
      aspect: "square",
    },
  );
  assert.equal(JSON.stringify(projected).includes("assetKey"), false);
});

test("Spotify artwork accepts only opaque i.scdn.co image keys in published tracks", () => {
  assert.deepEqual(
    artwork.normalizeSpotifyArtwork(`https://i.scdn.co/image/${coverKey}`),
    { kind: "spotify-cover", assetKey: `/image/${coverKey}` },
  );
  for (const unsafe of [
    `http://i.scdn.co/image/${coverKey}`,
    `https://evil.example/image/${coverKey}`,
    `https://i.scdn.co/image/${coverKey}?token=secret`,
    "https://i.scdn.co/image/%2fetc",
  ]) {
    assert.equal(artwork.normalizeSpotifyArtwork(unsafe), null, unsafe);
  }
  const source = artwork.resolveArtworkFromSnapshot(
    "spotify",
    {
      windows: {
        short_term: {
          tracks: [
            {
              id: trackId,
              album: {
                artwork: {
                  kind: "spotify-cover",
                  assetKey: `/image/${coverKey}`,
                },
              },
            },
          ],
        },
      },
    },
    trackId,
  );
  assert.deepEqual(source, {
    upstreamUrl: `https://i.scdn.co/image/${coverKey}`,
    cacheIdentity: `spotify-cover:/image/${coverKey}`,
    aspect: "square",
    cacheMaxAgeSeconds: 3600,
  });
  assert.equal(
    artwork.resolveArtworkFromSnapshot(
      "spotify",
      { windows: { short_term: { tracks: [] } } },
      trackId,
    ),
    null,
  );
});

test("Spotify fallback accepts only official track, album, or playlist references", () => {
  assert.deepEqual(
    normalizeSpotifyFallbackEmbed(
      `https://open.spotify.com/embed/track/${trackId}`,
    ),
    { kind: "track", spotifyId: trackId },
  );
  assert.deepEqual(
    normalizeSpotifyFallbackEmbed(
      `<iframe src="https://open.spotify.com/playlist/${trackId}?utm_source=generator&amp;theme=0"></iframe>`,
    ),
    { kind: "playlist", spotifyId: trackId },
  );
  assert.deepEqual(
    normalizeSpotifyFallbackEmbed(
      `https://open.spotify.com/track/${trackId}?si=owner-share-reference`,
    ),
    { kind: "track", spotifyId: trackId },
  );
  for (const unsafe of [
    `http://open.spotify.com/track/${trackId}`,
    `https://evil.example/track/${trackId}`,
    `https://open.spotify.com/artist/${trackId}`,
    `https://open.spotify.com/track/${trackId}#fragment`,
  ]) {
    assert.equal(normalizeSpotifyFallbackEmbed(unsafe), null, unsafe);
  }
});

test("Spotify snapshots use an exact public schema and the projector never spreads extras", () => {
  const now = "2026-08-02T12:00:00.000Z";
  const track = {
    id: trackId,
    position: 1,
    title: "A track",
    artists: [{ id: artistId, name: "An artist" }],
    album: { id: albumId, title: "An album", releaseYear: 2026 },
    durationMs: 180_000,
    explicit: false,
  };
  const payload = {
    provider: "spotify",
    snapshotVersion: 1,
    profileUrl: `https://open.spotify.com/user/${"4".repeat(22)}`,
    coverage: "Spotify-calculated affinity; not play counts",
    windows: {
      short_term: { tracks: [track] },
      medium_term: { tracks: [] },
      long_term: { tracks: [] },
    },
    syncedAt: now,
    freshUntil: now,
  };
  assert.equal(payloadPolicy.validateConnectorPublicPayload("spotify", payload), true);

  const polluted = structuredClone(payload);
  polluted.windows.short_term.tracks[0].popularity = 99;
  assert.equal(
    payloadPolicy.validateConnectorPublicPayload("spotify", polluted),
    false,
  );
  const projected = gallery.projectConnectorSnapshotForPublic(
    "spotify",
    polluted,
    new URLSearchParams(),
  );
  assert.equal(
    Object.hasOwn(projected.windows.short_term.tracks[0], "popularity"),
    false,
  );
});

test("Spotify Top Tracks remain withheld until the owner explicitly acknowledges publication", async () => {
  const database = new PresentationD1();
  await withRuntimeBindings({ DB: database }, async () => {
    assert.deepEqual(await getSpotifyPresentationConfig(), {
      status: "ready",
      config: {
        publishTopTracks: false,
        reviewedAt: null,
        fallbackEmbed: null,
        updatedAt: null,
        updatedByEmail: null,
      },
    });
    assert.deepEqual(
      await saveSpotifyPresentationConfig({
        publishTopTracks: true,
        acknowledgePublicDisplay: false,
        actorEmail: "owner@example.com",
      }),
      { status: "invalid", reason: "acknowledgement" },
    );
    assert.equal(database.setting, null);
    assert.deepEqual(await getPublicConnectorSnapshot("spotify"), {
      status: "unavailable",
      provider: "spotify",
      reason: "visibility_withheld",
    });

    const saved = await saveSpotifyPresentationConfig({
      publishTopTracks: true,
      acknowledgePublicDisplay: true,
      fallbackEmbed: `https://open.spotify.com/track/${trackId}`,
      actorEmail: "owner@example.com",
    });
    assert.equal(saved.status, "saved");
    assert.equal(saved.config.publishTopTracks, true);
    assert.deepEqual(saved.config.fallbackEmbed, {
      kind: "track",
      spotifyId: trackId,
    });
    assert.equal(database.audits.length, 1);

    const now = new Date().toISOString();
    database.snapshots = [
      {
        status: "ready",
        publicPayloadJson: JSON.stringify({
          provider: "spotify",
          snapshotVersion: 1,
          profileUrl: `https://open.spotify.com/user/${"4".repeat(22)}`,
          coverage: "Spotify-calculated affinity; not play counts",
          windows: {
            short_term: { tracks: [] },
            medium_term: { tracks: [] },
            long_term: { tracks: [] },
          },
          syncedAt: now,
          freshUntil: now,
        }),
        fetchedAt: now,
        freshUntil: now,
      },
    ];
    const published = await getPublicConnectorSnapshot("spotify");
    assert.equal(published.status, "ready");
    assert.equal(published.provider, "spotify");
  });
});
