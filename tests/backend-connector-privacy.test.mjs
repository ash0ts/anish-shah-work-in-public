import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const {
  normalizeConnectorProfileUrl,
  parseStoredConnectorPublicPayload,
  validateConnectorPublicPayload,
} = await tsImport(
  "../lib/server/connectors/public-payload-policy.ts",
  import.meta.url,
);
const { connectorRefreshResponse } = await tsImport(
  "../lib/server/http/connector-refresh-response.ts",
  import.meta.url,
);

const syncedAt = "2026-07-30T18:00:00.000Z";
const freshUntil = "2026-07-31T06:00:00.000Z";

function safePayload(provider, profileUrl) {
  assert.equal(provider, "myanimelist");
  return {
    provider,
    snapshotVersion: 3,
    profileUrl,
    coverage: "Complete anime library at sync",
    status: [{ label: "Completed", count: 1 }],
    genres: [{ label: "Action", count: 1 }],
    eras: [{ label: "2020s", count: 1 }],
    scores: [{ label: "8", count: 1 }],
    recent: [{
      id: "1",
      title: "A safe title",
      status: "Completed",
      score: 8,
      episodesWatched: 12,
      updatedAt: syncedAt,
    }],
    library: [{
      id: "1",
      title: "A safe title",
      startDate: "2020-01-01",
      releaseYear: 2020,
      genres: ["Action"],
      status: "Completed",
      score: 8,
      episodesWatched: 12,
      updatedAt: syncedAt,
    }],
    syncedAt,
    freshUntil,
  };
}

test("connector profile URLs use exact HTTPS host and path allowlists", () => {
  assert.equal(
    normalizeConnectorProfileUrl(
      "myanimelist",
      "https://myanimelist.net/profile/Anish_123/",
    ),
    "https://myanimelist.net/profile/Anish_123",
  );
  assert.equal(
    normalizeConnectorProfileUrl(
      "hardcover",
      "https://hardcover.app/@anish_shah/",
    ),
    "https://hardcover.app/@anish_shah",
  );
  assert.equal(
    normalizeConnectorProfileUrl(
      "steam",
      "https://steamcommunity.com/profiles/76561198000000000/",
    ),
    "https://steamcommunity.com/profiles/76561198000000000",
  );

  const rejected = [
    ["myanimelist", "http://myanimelist.net/profile/anish"],
    ["myanimelist", "https://localhost/profile/anish"],
    ["myanimelist", "https://127.0.0.1/profile/anish"],
    ["myanimelist", "https://myanimelist.net.evil.test/profile/anish"],
    ["myanimelist", "https://token@myanimelist.net/profile/anish"],
    ["myanimelist", "https://myanimelist.net/profile/anish?token=secret"],
    ["myanimelist", "https://myanimelist.net/profile/anish#private"],
    ["myanimelist", "https://myanimelist.net/users/anish"],
    ["hardcover", "https://hardcover.app/anish"],
    ["hardcover", "https://api.hardcover.app/@anish"],
    ["hardcover", "https://hardcover.app/@anish?token=secret"],
    ["hardcover", "file:///Users/example/private"],
    ["steam", "http://steamcommunity.com/profiles/76561198000000000"],
    ["steam", "https://api.steampowered.com/profiles/76561198000000000"],
    ["steam", "https://steamcommunity.com/id/anish"],
    ["steam", "https://key@steamcommunity.com/profiles/76561198000000000"],
    ["steam", "https://steamcommunity.com/profiles/76561198000000000?key=x"],
  ];

  for (const [provider, value] of rejected) {
    assert.equal(
      normalizeConnectorProfileUrl(provider, value),
      null,
      `${value} should be rejected`,
    );
  }
});

test("connector public payload policy permits only the allowlisted profile URL", () => {
  const safe = safePayload(
    "myanimelist",
    "https://myanimelist.net/profile/anish",
  );
  assert.equal(validateConnectorPublicPayload("myanimelist", safe), true);
  assert.equal(
    validateConnectorPublicPayload("myanimelist", {
      ...safe,
      syncedAt: "2026-07-30T18:00:00Z",
    }),
    false,
  );
  assert.deepEqual(
    parseStoredConnectorPublicPayload("myanimelist", JSON.stringify(safe)),
    safe,
  );
  assert.equal(
    validateConnectorPublicPayload("myanimelist", {
      ...safe,
      library: [{ ...safe.library[0], providerMetadata: "not public" }],
    }),
    false,
  );
  const safeHardcover = {
    provider: "hardcover",
    snapshotVersion: 3,
    profileUrl: "https://hardcover.app/@anish",
    coverage: "Complete book library at sync",
    status: [{ label: "Read", count: 1 }],
    ratings: [{ label: "5", count: 1 }],
    recent: [{
      id: "1",
      title: "Safe Book",
      slug: "safe-book",
      status: "Read",
      rating: 5,
      updatedAt: syncedAt,
    }],
    library: [{
      id: "1",
      title: "Safe Book",
      slug: "safe-book",
      status: "Read",
      rating: 5,
      updatedAt: syncedAt,
    }],
    syncedAt,
    freshUntil,
  };
  assert.equal(validateConnectorPublicPayload("hardcover", safeHardcover), true);
  assert.equal(
    validateConnectorPublicPayload("hardcover", {
      ...safeHardcover,
      rawResponse: {},
    }),
    false,
  );
  const safeSteam = {
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
    topPlayed: [
      { appId: "10", title: "Safe Game", hoursRounded: 10 },
    ],
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
    syncedAt,
    freshUntil,
  };
  assert.equal(validateConnectorPublicPayload("steam", safeSteam), true);
  assert.equal(
    validateConnectorPublicPayload("steam", {
      ...safeSteam,
      apiKey: "must-never-persist",
    }),
    false,
  );
  assert.equal(
    validateConnectorPublicPayload("steam", {
      ...safeSteam,
      metadata: { steam_id: "76561198000000000" },
    }),
    false,
  );

  const unsafePayloads = [
    {
      ...safe,
      profileUrl: "https://secret@myanimelist.net/profile/anish",
    },
    {
      ...safe,
      recent: [{ id: "1", title: "Book", coverImage: "https://images.test/x" }],
    },
    {
      ...safe,
      recent: [{ id: "1", title: "Book", sourceUrl: "https://example.test" }],
    },
    {
      ...safe,
      recent: [{ id: "1", title: "https://example.test/tracker" }],
    },
    {
      ...safe,
      recent: [{ id: "1", title: "file:///Users/example/private" }],
    },
    {
      ...safe,
      recent: [{ id: "1", title: "https://wandb.slack.com/archives/private" }],
    },
    {
      ...safe,
      provider: "hardcover",
    },
  ];

  for (const payload of unsafePayloads) {
    assert.equal(validateConnectorPublicPayload("myanimelist", payload), false);
    assert.equal(
      parseStoredConnectorPublicPayload(
        "myanimelist",
        JSON.stringify(payload),
      ),
      null,
    );
  }
  assert.equal(
    parseStoredConnectorPublicPayload("myanimelist", "{not-json"),
    null,
  );
});

test("connector repository validates public payloads before D1 writes and reads", async () => {
  const [snapshotReads, refreshWrites] = await Promise.all([
    readFile(
      new URL(
        "../lib/server/connectors/repository-snapshots.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../lib/server/connectors/repository-refresh.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const writeBoundary = refreshWrites.indexOf(
    "if (!validateConnectorPublicPayload(provider, publicPayload))",
  );
  const serialization = refreshWrites.indexOf(
    "JSON.stringify(publicPayload)",
    writeBoundary,
  );

  assert(writeBoundary >= 0);
  assert(serialization > writeBoundary);
  assert.match(snapshotReads, /parseStoredConnectorPublicPayload\(\s*provider,/);
  assert.match(snapshotReads, /reason: "invalid_snapshot"/);
});

test("collection projectors enumerate provider fields instead of spreading stored records", async () => {
  const source = await readFile(
    new URL("../lib/server/connectors/public-gallery.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /function projectMyAnimeListItem/);
  assert.match(source, /function projectHardcoverItem/);
  assert.match(source, /function projectSteamItem/);
  assert.doesNotMatch(source, /\.\.\.publicItem/);
  assert.doesNotMatch(source, /const \{\s*library[^}]*\.\.\./);
});

test("public connector responses are never reusable after disconnect", async () => {
  const route = await readFile(
    new URL(
      "../app/api/connectors/[provider]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(
    (route.match(/"cache-control": "no-store"/g) ?? []).length,
    3,
  );
  assert.doesNotMatch(route, /public,\s*max-age|stale-while-revalidate/i);
});

test("provider normalizers reduce artwork to host-free references", async () => {
  const [myAnimeList, hardcover] = await Promise.all([
    readFile(
      new URL("../lib/server/connectors/myanimelist.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/server/connectors/hardcover.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(myAnimeList, /main_picture/);
  assert.match(hardcover, /\bimage\s*\{/);
  for (const source of [myAnimeList, hardcover]) {
    assert.doesNotMatch(source, /publicPayload[\s\S]*?https:\/\/.*(?:jpg|png|webp)/i);
  }
});

test("Play fetches a personal-data provider only after its stream is active", async () => {
  const [source, collection, movement, spotify, discogs] = await Promise.all([
    readFile(
      new URL("../components/PersonalStreams.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/play/CollectionStream.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/play/MovementStream.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/SpotifyStream.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/play/DiscogsStream.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    source,
    /active === "watch"[\s\S]*?<CollectionStream provider="myanimelist"/,
  );
  assert.match(
    source,
    /active === "read"[\s\S]*?<CollectionStream provider="hardcover"/,
  );
  assert.match(
    source,
    /<SpotifyStream active=\{active === "listen"\} serverFallback=\{spotifyNoScript\}/,
  );
  assert.match(
    source,
    /active === "collect"[\s\S]*?<DiscogsStream/,
  );
  assert.match(
    source,
    /active === "play"[\s\S]*?<CollectionStream provider="steam"/,
  );
  assert.match(
    source,
    /active === "move"[\s\S]*?<MovementStream/,
  );
  assert.match(
    collection,
    /function CollectionStream[\s\S]*?loadConnector<CollectionPayload>\(\s*provider,/,
  );
  assert.match(
    movement,
    /function MovementStream[\s\S]*?loadConnector<StravaPayload>\(\s*"strava",/,
  );
  assert.match(
    spotify,
    /function SpotifyStream[\s\S]*?loadSpotify\(controller\.signal\)/,
  );
  assert.match(
    discogs,
    /function DiscogsStream[\s\S]*?loadConnector<DiscogsPublicSnapshot>\([\s\S]*?"discogs"/,
  );
  assert.doesNotMatch(source, /Promise\.all\([^)]*loadConnector/);
  assert.match(source, /show=\{showStrava\}/);
  assert.match(source, /onShow=\{\(\) => setShowStrava\(true\)\}/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_STRAVA_EMBED_URL/);
  assert.match(movement, /src=\{state\.payload\.embed\.embedUrl\}/);
});

test("Studio documents setup, replacement, and official provider sources", async () => {
  const [page, connectorSources, editorial, guide] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    Promise.all(
      [
        "../app/studio/ConnectorControls.tsx",
        "../app/studio/connectors/ApiConnectorPanel.tsx",
        "../app/studio/connectors/helpers.ts",
        "../app/studio/connectors/MyAnimeListConnectorPanel.tsx",
        "../app/studio/connectors/HardcoverConnectorPanel.tsx",
        "../app/studio/connectors/SpotifyConnectorPanel.tsx",
        "../app/studio/connectors/DiscogsConnectorPanel.tsx",
        "../app/studio/connectors/SteamConnectorPanel.tsx",
        "../app/studio/connectors/StravaConnectorPanel.tsx",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    ),
    readFile(
      new URL("../app/studio/EditorialRecords.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../docs/play-connections.md", import.meta.url), "utf8"),
  ]);
  const controls = connectorSources.join("\n");

  const setupSurface = `${page}\n${controls}\n${guide}`;
  for (const officialUrl of [
    "https://myanimelist.net/apiconfig",
    "https://hardcover.app/account/api",
    "https://docs.hardcover.app/api/getting-started/",
    "https://developer.spotify.com/dashboard",
    "https://www.discogs.com/settings/developers",
    "https://partner.steamgames.com/doc/webapi_overview",
    "https://steamcommunity.com/dev/apikey",
    "https://support.strava.com/en-us/articles/15402053-sharing-your-activities-and-routes-with-a-strava-embed",
  ]) {
    assert.match(
      setupSurface,
      new RegExp(officialUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(controls, /Replace credential/);
  assert.match(controls, /credential_expired/);
  assert.match(controls, /rate_limited/);
  assert.match(controls, /provider_unavailable/);
  assert.match(controls, /Bearer optional/);
  assert.match(controls, /Cancel pending authorization/);
  assert.match(controls, /canReuseOAuthClient/);
  assert.match(controls, /\/api\/studio\/connectors\/myanimelist\/oauth\/start/);
  assert.match(controls, /\/api\/studio\/connectors\/spotify\/oauth\/start/);
  assert.match(
    setupSurface,
    /\/api\/connectors\/myanimelist\/oauth\/callback/,
  );
  assert.match(controls, /\/api\/studio\/connectors\/strava\/config/);
  assert.match(controls, /Studio stores the resulting tokens/);
  assert.match(page, /Local sandbox · isolated data/);
  assert.match(page, /Changes here stay on this machine/);
  assert.match(page, /isLocalSandbox=\{isLocalStudio\}/);
  assert.match(controls, /has not been copied to production/);
  assert.match(editorial, /Create local snapshot/);
  assert.match(editorial, /production is unchanged/);
  assert.match(guide, /client ID.*client secret/is);
  assert.match(guide, /Refresh now.*Current/is);
  assert.match(guide, /one-time[\s\S]*transfer code/i);
  assert.match(
    guide,
    /Authorize MyAnimeList, Spotify, and Discogs separately/i,
  );
  assert.match(guide, /Reauthorization required/);
  assert.match(guide, /one year/i);
  assert.match(guide, /January\s+1/i);
  assert.match(guide, /npm run lint && npm test/);
  assert.doesNotMatch(guide, /Renewal is manual/);
  assert.match(guide, /strava-embeds\.com/);
  assert.match(guide, /www\.strava\.com\/athletes/);
  assert.match(guide, /profile feed|weekly summary/i);
  assert.match(guide, /profile-link fallback|profile link fallback/i);
  assert.match(guide, /does not fetch, copy, aggregate, or custom-visualize/);
  assert.match(controls, /anonymous frame check/);
  assert.match(controls, /Use only Strava-generated values/);
});

test("Studio connector mutations preserve the page and give safe refresh guidance", async () => {
  const [panel, helpers, refreshHandler, refreshResponse] = await Promise.all([
    readFile(
      new URL("../app/studio/connectors/ApiConnectorPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/studio/connectors/helpers.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/server/http/connector-refresh.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/server/http/connector-refresh-response.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(panel, /import \{ useRouter \} from "next\/navigation"/);
  assert.match(panel, /const router = useRouter\(\)/);
  assert.match(
    panel,
    /focusAfterMutation\.current === "refresh"[\s\S]*?refreshButton\.current[\s\S]*?firstCredentialField\.current/,
  );
  assert.match(panel, /target\.focus\(\)/);
  assert.equal(
    [...panel.matchAll(/ref=\{firstCredentialField\}/g)].length,
    3,
    "every credential form should expose its first field for focus recovery",
  );
  assert.equal(
    [...panel.matchAll(/ref=\{refreshButton\}/g)].length,
    1,
    "the post-save refresh control should expose a stable focus target",
  );
  const failedResponse = panel.match(
    /if \(!response\.ok\) \{([\s\S]*?)\n      \}\n\n      setSecret/,
  );
  assert.ok(failedResponse, "failed response branch should remain explicit");
  assert.match(failedResponse[1], /setMessage\(/);
  assert.match(failedResponse[1], /return;/);
  assert.doesNotMatch(failedResponse[1], /router\.refresh/);
  assert.match(
    panel,
    /\} catch \{\n      setMessage\("The request could not be completed\. Try again\."\);\n    \} finally/,
  );
  assert.match(
    panel,
    /if \(action === "save"\) \{[\s\S]*?focusAfterMutation\.current = "refresh"[\s\S]*?setShowCredentialForm\(false\)/,
  );
  assert.match(
    panel,
    /if \(action === "disconnect"\) \{[\s\S]*?focusAfterMutation\.current = "credential"[\s\S]*?setShowCredentialForm\(true\)/,
  );
  assert.match(panel, /setMessage\([\s\S]*?router\.refresh\(\)/);
  assert.doesNotMatch(panel, /window\.location\.reload/);
  assert.doesNotMatch(panel, /setTimeout\([^)]*location\.reload/);
  const refreshControl = panel.match(
    /<button\s+ref=\{refreshButton\}([\s\S]*?)<\/button>/,
  );
  assert.ok(refreshControl, "Refresh now should retain a dedicated button");
  assert.match(refreshControl[0], /type="button"/);
  assert.match(refreshControl[0], /onClick=\{\(\) => void request\("refresh"\)\}/);
  assert.match(
    refreshControl[0],
    /disabled=\{pending !== null \|\| connectorBlocked \|\| retryBlocked\}/,
  );
  assert.match(refreshControl[0], /Refreshing…/);
  assert.match(panel, /className=\{styles\.formMessage\} role="status"/);
  assert.match(
    helpers,
    /A refresh is already running\. Check this panel again in a moment/,
  );
  assert.match(
    helpers,
    /lastErrorCode === "public_payload_rejected"[\s\S]*?no new snapshot passed public validation\.[\s\S]*?Do not replace the credential; any previously accepted snapshot remains unchanged/,
  );
  assert.match(
    helpers,
    /The last refresh failed\. No new snapshot was published; any previously accepted snapshot remains unchanged\./,
  );
  assert.match(
    helpers,
    /Any previously accepted public snapshot remains unchanged\./,
  );
  assert.doesNotMatch(helpers, /snapshot remains available/);
  assert.match(
    refreshResponse,
    /public_payload_rejected[\s\S]*?no new snapshot passed public validation\.[\s\S]*?Do not replace the credential/,
  );
  assert.match(
    refreshResponse,
    /No new snapshot was published\. Any previously accepted snapshot remains unchanged\./,
  );
  assert.match(
    refreshHandler,
    /import \{ connectorRefreshResponse \} from "\.\/connector-refresh-response"/,
  );
  assert.match(refreshHandler, /return connectorRefreshResponse\(result\)/);
});

test("Discogs rate-limit responses expose a standard retry contract", async () => {
  const now = Date.parse("2026-08-03T16:00:00.000Z");
  const retryNotBefore = "2026-08-03T16:01:30.000Z";
  const response = connectorRefreshResponse(
    {
      status: "failed",
      provider: "discogs",
      code: "rate_limited",
      retryable: true,
      retryNotBefore,
    },
    now,
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("retry-after"), "90");
  assert.deepEqual(await response.json(), {
    status: "failed",
    provider: "discogs",
    code: "rate_limited",
    retryable: true,
    retryNotBefore,
    error: `The provider is rate-limiting requests. Retry after ${retryNotBefore}. No new snapshot was published; any previously accepted snapshot remains unchanged.`,
  });
});
