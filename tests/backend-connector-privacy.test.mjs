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
    ["hardcover", "file:///Users/ashah/private"],
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
      recent: [{ id: "1", title: "file:///Users/ashah/private" }],
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

test("provider normalizers do not request or publish remote cover URLs", async () => {
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

  for (const source of [myAnimeList, hardcover]) {
    assert.doesNotMatch(source, /coverImage/);
  }
  assert.doesNotMatch(myAnimeList, /main_picture/);
  assert.doesNotMatch(hardcover, /\bimage\s*\{/);
});
