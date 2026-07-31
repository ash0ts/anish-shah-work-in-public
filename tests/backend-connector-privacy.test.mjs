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

const syncedAt = "2026-07-30T18:00:00.000Z";
const freshUntil = "2026-07-31T06:00:00.000Z";

function safePayload(provider, profileUrl) {
  return {
    provider,
    profileUrl,
    coverage: "Current library",
    recent: [{ id: "1", title: "A safe title", updatedAt: syncedAt }],
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
  assert.deepEqual(
    parseStoredConnectorPublicPayload("myanimelist", JSON.stringify(safe)),
    safe,
  );
  const safeSteam = {
    provider: "steam",
    profileUrl:
      "https://steamcommunity.com/profiles/76561198000000000",
    coverage: "Public Steam game details returned at sync",
    totals: {
      publicGameCount: 1,
      playedGameCount: 1,
      totalHoursRounded: 10,
    },
    topPlayed: [
      { appId: "10", title: "Safe Game", hoursRounded: 10 },
    ],
    recent: [],
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
  const repository = await readFile(
    new URL("../lib/server/connectors/repository.ts", import.meta.url),
    "utf8",
  );
  const writeBoundary = repository.indexOf(
    "if (!validateConnectorPublicPayload(provider, publicPayload))",
  );
  const serialization = repository.indexOf(
    "JSON.stringify(publicPayload)",
    writeBoundary,
  );

  assert(writeBoundary >= 0);
  assert(serialization > writeBoundary);
  assert.match(repository, /parseStoredConnectorPublicPayload\(\s*provider,/);
  assert.match(repository, /reason: "invalid_snapshot"/);
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
  const source = await readFile(
    new URL("../components/PersonalStreams.tsx", import.meta.url),
    "utf8",
  );

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
    /active === "play"[\s\S]*?<CollectionStream provider="steam"/,
  );
  assert.match(
    source,
    /active === "move"[\s\S]*?<MovementProvider/,
  );
  assert.match(
    source,
    /function CollectionStream[\s\S]*?loadConnector<CollectionPayload>\(\s*provider,/,
  );
  assert.match(
    source,
    /function MovementProvider[\s\S]*?loadConnector<StravaPayload>\(\s*"strava",/,
  );
  assert.doesNotMatch(source, /Promise\.all\([^)]*loadConnector/);
  assert.match(source, /show=\{showStrava\}/);
  assert.match(source, /onShow=\{\(\) => setShowStrava\(true\)\}/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_STRAVA_EMBED_URL/);
  assert.match(source, /src=\{state\.payload\.embed\.embedUrl\}/);
});

test("Studio documents setup, replacement, and official provider sources", async () => {
  const [page, controls, editorial, guide] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/studio/ConnectorControls.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/studio/EditorialRecords.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../docs/play-connections.md", import.meta.url), "utf8"),
  ]);

  const setupSurface = `${page}\n${controls}\n${guide}`;
  for (const officialUrl of [
    "https://myanimelist.net/apiconfig",
    "https://hardcover.app/account/api",
    "https://docs.hardcover.app/api/getting-started/",
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
  assert.match(guide, /Authorize MyAnimeList separately/i);
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
