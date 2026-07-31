import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const {
  connectorSnapshotNeedsUpgrade,
  projectConnectorSnapshotForPublic,
} = await import("../lib/server/connectors/public-gallery.ts");

function params(value = "") {
  return new URLSearchParams(value);
}

test("legacy connector snapshots request an upgrade without exposing a library", () => {
  const payload = {
    provider: "myanimelist",
    profileUrl: "https://myanimelist.net/profile/anish",
    coverage: "Most recently updated 500 entries",
    recent: [],
  };

  assert.equal(connectorSnapshotNeedsUpgrade(payload), true);
  const projected = projectConnectorSnapshotForPublic(
    "myanimelist",
    payload,
    params(),
  );
  assert.equal(Object.hasOwn(projected, "library"), false);
  assert.equal(projected.gallery.ready, false);
  assert.deepEqual(projected.gallery.items, []);
});

test("MyAnimeList gallery is filtered, sorted, and page bounded", () => {
  const library = Array.from({ length: 50 }, (_, index) => ({
    id: String(index + 1),
    title: `Title ${String(index + 1).padStart(2, "0")}`,
    status: index % 2 === 0 ? "Completed" : "Watching",
    score: index % 11,
    releaseYear: 1990 + index,
    updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  }));
  const payload = {
    provider: "myanimelist",
    snapshotVersion: 2,
    profileUrl: "https://myanimelist.net/profile/anish",
    coverage: "Complete library snapshot",
    library,
  };

  assert.equal(connectorSnapshotNeedsUpgrade(payload), false);
  const projected = projectConnectorSnapshotForPublic(
    "myanimelist",
    payload,
    params("filter=watching&sort=year&page=2&pageSize=12"),
  );

  assert.equal(Object.hasOwn(projected, "library"), false);
  assert.equal(projected.gallery.ready, true);
  assert.equal(projected.gallery.libraryTotal, 50);
  assert.equal(projected.gallery.totalItems, 25);
  assert.equal(projected.gallery.page, 2);
  assert.equal(projected.gallery.pageSize, 12);
  assert.equal(projected.gallery.items.length, 12);
  assert(
    projected.gallery.items.every((item) => item.status === "Watching"),
  );
  assert(
    projected.gallery.items[0].releaseYear >
      projected.gallery.items.at(-1).releaseYear,
  );
});

test("Steam gallery exposes only a page-sized sanitized projection", () => {
  const library = Array.from({ length: 80 }, (_, index) => ({
    appId: String(10_000 + index),
    title: index === 13 ? "A precise query target" : `Game ${index + 1}`,
    played: index > 0,
    recentlyPlayed: index % 8 === 0,
    totalHoursRounded: index,
    recentHoursRounded: index % 8 === 0 ? 2 : 0,
  }));
  const projected = projectConnectorSnapshotForPublic(
    "steam",
    {
      provider: "steam",
      snapshotVersion: 2,
      profileUrl:
        "https://steamcommunity.com/profiles/76561198000000000",
      coverage: "Complete public Steam library snapshot",
      library,
    },
    params("q=precise%20query&filter=played&sort=playtime&pageSize=36"),
  );

  assert.equal(Object.hasOwn(projected, "library"), false);
  assert.equal(projected.gallery.libraryTotal, 80);
  assert.equal(projected.gallery.totalItems, 1);
  assert.equal(projected.gallery.items.length, 1);
  assert.equal(projected.gallery.items[0].title, "A precise query target");
  assert(projected.gallery.items.length <= 36);
});

test("invalid gallery controls fall back to safe defaults", () => {
  const projected = projectConnectorSnapshotForPublic(
    "hardcover",
    {
      provider: "hardcover",
      snapshotVersion: 2,
      profileUrl: "https://hardcover.app/@anish",
      coverage: "Complete library snapshot",
      library: [
        {
          id: "1",
          title: "Book",
          status: "Read",
          rating: 4,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    params(
      "q=this-query-is-deliberately-longer-than-eighty-characters-and-must-not-be-reflected-anywhere-at-all-12345&page=-1&pageSize=1000&filter=not-real&sort=not-real",
    ),
  );

  assert.equal(projected.gallery.query, "");
  assert.equal(projected.gallery.page, 1);
  assert.equal(projected.gallery.pageSize, 24);
  assert.equal(projected.gallery.filter, "all");
  assert.equal(projected.gallery.sort, "recent");
});
