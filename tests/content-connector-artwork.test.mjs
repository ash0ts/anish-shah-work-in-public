import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const {
  normalizeHardcoverArtwork,
  normalizeMyAnimeListArtwork,
  normalizeSteamArtwork,
  resolveArtworkFromSnapshot,
} = await import("../lib/server/connectors/artwork.ts");
const { projectConnectorSnapshotForPublic } = await import(
  "../lib/server/connectors/public-gallery.ts"
);

test("provider artwork is reduced to strict host-free references", () => {
  assert.deepEqual(
    normalizeMyAnimeListArtwork(
      "https://cdn.myanimelist.net/images/anime/1935/127974l.jpg",
    ),
    {
      kind: "mal-cover",
      assetKey: "/images/anime/1935/127974l.jpg",
    },
  );
  assert.deepEqual(
    normalizeHardcoverArtwork(
      "https://assets.hardcover.app/uploads/book/image/42/cover.webp",
    ),
    {
      kind: "hardcover-cover",
      assetKey: "/uploads/book/image/42/cover.webp",
    },
  );
  assert.deepEqual(
    normalizeSteamArtwork("440", "a".repeat(40)),
    { kind: "steam-icon", appId: "440", hash: "a".repeat(40) },
  );

  for (const value of [
    "https://evil.test/images/anime/1/cover.jpg",
    "https://cdn.myanimelist.net/images/anime/1/cover.svg",
    "https://cdn.myanimelist.net/images/anime/1/cover.jpg?token=secret",
    "https://cdn.myanimelist.net/images/anime/%2fetc/passwd.jpg",
  ]) {
    assert.equal(normalizeMyAnimeListArtwork(value), null, value);
  }
});

test("public gallery exposes only same-origin artwork paths", () => {
  const projected = projectConnectorSnapshotForPublic(
    "myanimelist",
    {
      provider: "myanimelist",
      snapshotVersion: 3,
      profileUrl: "https://myanimelist.net/profile/anish",
      coverage: "Complete library",
      library: [
        {
          id: "42",
          title: "Example",
          status: "Completed",
          artwork: {
            kind: "mal-cover",
            assetKey: "/images/anime/1/cover.jpg",
          },
        },
      ],
    },
    new URLSearchParams(),
  );
  assert.deepEqual(projected.gallery.items[0].artwork, {
    src: "/api/connector-artwork/myanimelist/42",
    aspect: "poster",
  });
  assert.equal(JSON.stringify(projected).includes("cdn.myanimelist.net"), false);
  assert.equal(JSON.stringify(projected).includes("assetKey"), false);
});

test("artwork resolution requires membership in the selected published snapshot", () => {
  const payload = {
    library: [
      {
        appId: "440",
        title: "Example",
        artwork: {
          kind: "steam-icon",
          appId: "440",
          hash: "b".repeat(40),
        },
      },
    ],
  };
  assert.deepEqual(resolveArtworkFromSnapshot("steam", payload, "440"), {
    upstreamUrl: `https://media.steampowered.com/steamcommunity/public/images/apps/440/${"b".repeat(40)}.jpg`,
    cacheIdentity: `steam-icon:440:${"b".repeat(40)}`,
    aspect: "square",
  });
  const replacement = resolveArtworkFromSnapshot(
    "steam",
    {
      library: [
        {
          appId: "440",
          artwork: {
            kind: "steam-icon",
            appId: "440",
            hash: "c".repeat(40),
          },
        },
      ],
    },
    "440",
  );
  assert.notEqual(
    replacement.cacheIdentity,
    resolveArtworkFromSnapshot("steam", payload, "440").cacheIdentity,
  );
  assert.equal(resolveArtworkFromSnapshot("steam", payload, "441"), null);
  assert.equal(resolveArtworkFromSnapshot("hardcover", payload, "440"), null);
});

test("artwork endpoint checks publication before cache and bounds upstream media", async () => {
  const source = await readFile(
    new URL(
      "../app/api/connector-artwork/[provider]/[itemId]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /getPublicConnectorSnapshot\(candidate\)/);
  assert.ok(
    source.indexOf("getPublicConnectorSnapshot(candidate)") <
      source.indexOf("cache?.match(cacheKey)"),
  );
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /MAX_ARTWORK_BYTES/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.match(source, /ALLOWED_MIME_TYPES/);
  assert.match(source, /matchesMimeSignature/);
  assert.match(source, /new TextEncoder\(\)\.encode\(source\.cacheIdentity\)/);
  assert.match(source, /cacheUrl\.searchParams\.set\("v", version\)/);
  assert.doesNotMatch(source, /image\/avif/);
  assert.doesNotMatch(source, /new URL\(request\.url\).*searchParams.*url/s);
});
