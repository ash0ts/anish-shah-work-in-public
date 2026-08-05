import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { isPlayPath } = await import("../worker/security-headers.ts");
const {
  collectionQueryFrom,
  collectionQueryFromGallery,
  discogsQueryFrom,
  discogsQueryFromGallery,
} = await import("../lib/server/play-query.ts");
const {
  INITIAL_ROOM_STATE,
  roomExperienceReducer,
} = await import("../components/play/room-platform/room-reducer.ts");
const {
  ROOM_OBJECT_CONTRACT,
  ROOM_OBJECT_IDS,
  ROOM_OBJECT_ROUTES,
  isRoomObjectId,
  roomObjectContract,
} = await import(
  "../components/play/room-platform/room-object-contract.ts"
);
const { updatedDateLabel } = await import(
  "../components/play/updated-date-label.ts"
);

const source = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const relativeLuminance = (hex) => {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

const contrastRatio = (foreground, background) => {
  const values = [relativeLuminance(foreground), relativeLuminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
};

test("Play screens share one deterministic updated-date formatter", () => {
  assert.equal(updatedDateLabel("2026-08-04T12:00:00.000Z"), "Updated Aug 4, 2026");
  assert.equal(updatedDateLabel("not-a-date"), "Sync date unavailable");
  assert.equal(
    updatedDateLabel("not-a-date", "Publish date unavailable"),
    "Publish date unavailable",
  );
});

const roomRegistryKeys = (text, name) => {
  const match = text.match(
    new RegExp(
      `${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}(?: as const)? satisfies`,
    ),
  );
  assert.ok(match, `Expected a satisfies-checked literal ${name} registry`);
  return [...match[1].matchAll(/^  (watch|read|listen|collect|play|move|travel):/gm)].map(
    ([, id]) => id,
  );
};

test("the dependency-free room contract closes seven routes and content sources", async () => {
  const [contract, registry] = await Promise.all([
    source("components/play/room-platform/room-object-contract.ts"),
    source("components/play/room-platform/room-registry.ts"),
  ]);
  const expectedIds = ["watch", "read", "listen", "collect", "play", "move", "travel"];
  assert.deepEqual(ROOM_OBJECT_IDS, expectedIds);
  assert.deepEqual(
    ROOM_OBJECT_ROUTES,
    expectedIds.map((id) => `/play/${id}`),
  );
  assert.equal(new Set(ROOM_OBJECT_CONTRACT.map(({ focusTarget }) => focusTarget)).size, 7);
  assert.equal(new Set(ROOM_OBJECT_CONTRACT.map(({ smokeTest }) => smokeTest)).size, 7);
  for (const [id, provider] of [
    ["watch", "myanimelist"],
    ["read", "hardcover"],
    ["listen", "spotify"],
    ["collect", "discogs"],
    ["play", "steam"],
    ["move", "strava"],
  ]) {
    const object = roomObjectContract(id);
    assert.equal(object.contentSource.kind, "connector");
    assert.equal(object.contentSource.provider, provider);
    assert.equal(object.meshRoot, `OBJ__${id}`);
  }
  assert.deepEqual(roomObjectContract("travel").contentSource, { kind: "travel-log" });
  assert.equal(isRoomObjectId("travel"), true);
  assert.equal(isRoomObjectId("unknown"), false);
  assert.equal(roomObjectContract("unknown"), null);
  assert.doesNotMatch(contract, /roomLabel:|label:/);
  assert.match(registry, /ROOM_OBJECT_CONTRACT\.map/);
  assert.match(registry, /ROOM_OBJECT_PRESENTATION_BY_ID/);
  assert.match(registry, /ROOM_OBJECT_CONTRACT\.map\(\(\{ id, focusTarget \}\)/);
  assert.match(registry, /as RoomFocusTargetRegistry/);
  assert.match(registry, /Record<RoomObjectId, RoomObjectDefinition>/);
  assert.match(registry, /return isRoomObjectId\(value\) \? ROOM_OBJECT_BY_ID\[value\] : null/);
});

test("room registries derive seven objects while connector dispatch excludes Travel", async () => {
  const [registry, screens, foundation, route, travelRoute] = await Promise.all([
    source("components/play/room-platform/room-registry.ts"),
    source("components/play/room-platform/room-screen-registry.ts"),
    source("lib/server/play-screen-foundation.ts"),
    source("app/play/[objectSlug]/page.tsx"),
    source("app/play/travel/page.tsx"),
  ]);
  const expected = ["watch", "read", "listen", "collect", "play", "move", "travel"];
  assert.deepEqual(roomRegistryKeys(screens, "ROOM_SCREEN_LOADERS"), expected);
  assert.deepEqual(
    roomRegistryKeys(route, "ROOM_ROUTE_FOUNDATIONS"),
    expected.filter((id) => id !== "travel"),
  );
  assert.deepEqual(
    roomRegistryKeys(foundation, "ROOM_PROVIDER_ADAPTERS"),
    expected.filter((id) => id !== "travel"),
    "ROOM_PROVIDER_ADAPTERS",
  );
  assert.match(registry, /ROOM_OBJECT_CONTRACT\.map\(\(structural\)/);
  assert.match(registry, /ROOM_OBJECT_CONTRACT\.map\(\(\{ id, focusTarget \}\)/);
  assert.match(travelRoute, /ROOM_SCREEN_LOADERS\.travel\(\)/);
});

test("the room reducer clamps rotation and ignores stale transitions", async () => {
  const reducer = await source("components/play/room-platform/room-reducer.ts");
  assert.match(reducer, /Math\.max\(-7, Math\.min\(7, rotation\.x\)\)/);
  assert.match(reducer, /Math\.max\(-12, Math\.min\(12, rotation\.y\)\)/);
  assert.match(reducer, /action\.epoch !== state\.transitionEpoch\) return state/);
  assert.match(reducer, /transitionEpoch: state\.transitionEpoch \+ 1/);
  assert.match(reducer, /entered: true, phase: "idle"/);
  assert.match(reducer, /phase: action\.id \? "presenting" : "idle"/);
  assert.match(reducer, /action\.type === "reset-view"/);
  assert.match(reducer, /if \(state\.fallbackReason\) return state/);
  assert.match(reducer, /fallbackReason: state\.fallbackReason/);
});

test("room hover and rotation actions are idempotent", () => {
  const focused = roomExperienceReducer(INITIAL_ROOM_STATE, {
    type: "focus",
    id: "watch",
  });
  assert.equal(
    roomExperienceReducer(focused, { type: "focus", id: "watch" }),
    focused,
  );

  const rotated = roomExperienceReducer(INITIAL_ROOM_STATE, {
    type: "rotate",
    rotation: { x: 4, y: -4 },
  });
  assert.equal(
    roomExperienceReducer(rotated, {
      type: "rotate",
      rotation: { x: 4, y: -4 },
    }),
    rotated,
  );
  assert.equal(
    roomExperienceReducer(INITIAL_ROOM_STATE, { type: "reset-view" }),
    INITIAL_ROOM_STATE,
  );
});

test("room transitions are cancellable, phased, and restore semantic focus", async () => {
  const [
    provider,
    runtime,
    entry,
    readiness,
    roomQuality,
    roomReview,
    screens,
  ] = await Promise.all([
    source("components/play/room-platform/RoomExperienceProvider.tsx"),
    source("components/play/room-platform/RoomRuntime.tsx"),
    source("components/play/room-platform/RoomEntryControl.tsx"),
    source("tests/browser/helpers/room-readiness.mjs"),
    source("tests/browser/room-quality.spec.mjs"),
    source("tests/browser/room-review.spec.mjs"),
    Promise.all(
      [
        "WatchRoomScreen.tsx",
        "ReadRoomScreen.tsx",
        "ListenRoomScreen.tsx",
        "CollectRoomScreen.tsx",
        "PlayRoomScreen.tsx",
        "MoveRoomScreen.tsx",
        "TravelRoomScreen.tsx",
      ].map((name) => source(`components/play/room-screens/${name}`)),
    ),
  ]);
  assert.match(provider, /import \{ animate \} from "animejs"/);
  assert.doesNotMatch(provider, /setTimeout\(/);
  assert.match(provider, /animation\.cancel\(\)/);
  assert.match(provider, /phase: "approaching"/);
  assert.match(provider, /phase: "navigating"/);
  assert.match(provider, /sessionRoomFailure = reason/);
  assert.match(provider, /pendingFocus\.current \?\? lastInvoker\.current/);
  assert.match(provider, /data-room-object-link/);
  assert.match(provider, /pendingRoomNavigation\.current = id/);
  assert.match(provider, /activeObjectRouteOrigin\.current === "room"/);
  assert.match(
    provider,
    /priorRouteObject === activeRouteObject &&[\s\S]*activeObjectRouteOrigin\.current === "room"/,
  );
  assert.ok(
    provider.includes(
      'if (/^\\/play\\/travel\\/trips\\/[^/]+\\/?$/.test(pathname))',
    ),
  );
  assert.match(provider, /if \(returnWithBrowserHistory\) router\.back\(\)/);
  assert.match(provider, /else \{[\s\S]*routeWithPreviewFixture\([\s\S]*"\/play"/);
  assert.match(provider, /previewFixtureFromSearch\(window\.location\.search\)/);
  assert.match(provider, /notifyRuntimeMounted/);
  assert.match(provider, /const focusObject = useCallback/);
  assert.match(provider, /const resetView = useCallback/);
  assert.match(provider, /const rotate = useCallback/);
  assert.doesNotMatch(provider, /focusObject: \(id\) => dispatch/);
  assert.match(provider, /Opened \$\{object\.label\}: \$\{object\.title\}\./);
  assert.ok(
    provider.includes(
      "announce(`Opening the ${object.object.toLowerCase()}: ${object.label}.`);",
    ),
  );
  assert.ok(
    !provider.includes(
      "announce(`Opening ${object.label} in the ${object.object.toLowerCase()}.`);",
    ),
  );
  assert.match(provider, /Returned to the room/);
  assert.match(provider, /data-room-return-status/);
  assert.match(provider, /Returning to the room/);
  assert.match(provider, /requestAnimationFrame\(navigate\)/);
  assert.match(runtime, /const presenting = room\.objectRouteActive && !returning/);
  assert.match(runtime, /data-room-ready=\{ready \? "true" : "false"\}/);
  assert.match(runtime, /data-returning=\{returning \|\| undefined\}/);
  assert.match(runtime, /const atLeftBound = room\.rotation\.y <= -12/);
  assert.match(runtime, /const atRightBound = room\.rotation\.y >= 12/);
  assert.match(runtime, /const atUpperBound = room\.rotation\.x <= -7/);
  assert.match(runtime, /const atLowerBound = room\.rotation\.x >= 7/);
  assert.equal(
    (runtime.match(/\sdisabled=\{at(?:Left|Right|Upper|Lower)Bound\}/g) ?? [])
      .length,
    4,
  );
  assert.match(entry, /if \(room\.fallbackReason\)/);
  assert.match(readiness, /ROOM_READY_TIMEOUT_MS = 15_000/);
  assert.match(readiness, /data-room-ready", "true"/);
  assert.match(readiness, /roomReadinessDiagnostics/);
  assert.match(readiness, /data-room-transition-phase/);
  assert.match(
    roomQuality,
    /import \{ expectRoomReady \} from "\.\/helpers\/room-readiness\.mjs"/,
  );
  assert.match(roomQuality, /context: "starting the slow-return scenario"/);
  assert.match(roomQuality, /context: "completing the slow room return"/);
  assert.match(
    roomReview,
    /import \{ expectRoomReady \} from "\.\/helpers\/room-readiness\.mjs"/,
  );
  assert.match(roomReview, /context: "capturing room review evidence"/);
  for (const screen of screens) assert.match(screen, /data-room-screen/);
});

test("My Room is authoritative and legacy stream links redirect permanently", async () => {
  const [mode, page, layout] = await Promise.all([
    source("lib/server/travel/runtime.ts"),
    source("app/play/page.tsx"),
    source("app/play/layout.tsx"),
  ]);
  assert.doesNotMatch(mode, /PLAY_EXPERIENCE_MODE/);
  assert.match(mode, /travelAtlasMode\(\) === "atlas-v1"/);
  assert.match(page, /permanentRedirect\(legacyObject\.route\)/);
  assert.match(page, /legacyObject\?\.contentSource\.kind === "connector"/);
  assert.match(page, /legacyStream === legacyObject\.id/);
  assert.match(page, /<RoomOverview/);
  assert.doesNotMatch(page, /ClassicPlayExperience|PersonalStreams/);
  assert.match(layout, /<RoomExperienceProvider/);
  assert.doesNotMatch(layout, /roomExperienceEnabled|return children/);
});

test("direct collection parameters are bounded and provider-allowlisted", () => {
  assert.deepEqual(
    collectionQueryFrom(
      {
        q: `  ${"x".repeat(100)}  `,
        filter: "Watching-Now",
        sort: "score",
        page: "42",
        pageSize: "24",
      },
      "myanimelist",
    ),
    {
      query: "x".repeat(80),
      filter: "watching-now",
      sort: "score",
      page: 42,
      pageSize: 24,
    },
  );

  assert.deepEqual(
    collectionQueryFrom(
      {
        q: "unsafe\u0000query",
        filter: "../../private",
        sort: "score",
        page: "999999999999999999999",
        pageSize: "24items",
      },
      "hardcover",
    ),
    {
      query: "",
      filter: "",
      sort: "",
      page: 1,
      pageSize: 12,
    },
  );

  assert.equal(
    collectionQueryFrom({ sort: "playtime" }, "steam").sort,
    "playtime",
  );
  assert.equal(
    collectionQueryFrom({ sort: "playtime" }, "myanimelist").sort,
    "",
  );
});

test("Discogs parameters reject unknown sorts and unsafe dynamic tokens", () => {
  assert.deepEqual(
    discogsQueryFrom({
      q: "  Blue Logic  ",
      format: "Vinyl",
      decade: "1990s",
      sort: "year",
      page: "2",
      pageSize: "36",
    }),
    {
      view: "pattern",
      query: "Blue Logic",
      format: "vinyl",
      decade: "1990s",
      sort: "year",
      page: 2,
      pageSize: 36,
    },
  );

  assert.deepEqual(
    discogsQueryFrom({
      format: "vinyl<script>",
      decade: "1990s/../../",
      sort: "recent",
      page: "2oops",
      pageSize: "0",
    }),
    {
      view: "pattern",
      query: "",
      format: "",
      decade: "",
      sort: "",
      page: 1,
      pageSize: 12,
    },
  );

  assert.equal(discogsQueryFrom({ view: "gallery" }).view, "gallery");
  assert.equal(discogsQueryFrom({ view: "unsafe" }).view, "pattern");
});

test("projected gallery state is canonicalized before RSC serialization", () => {
  assert.deepEqual(
    collectionQueryFromGallery(
      {
        query: "  finished  ",
        filter: "Completed",
        sort: "rating",
        page: 3,
        pageSize: 24,
      },
      "hardcover",
    ),
    {
      query: "finished",
      filter: "completed",
      sort: "rating",
      page: 3,
      pageSize: 24,
    },
  );
  assert.deepEqual(
    discogsQueryFromGallery({
      query: "ambient",
      format: "vinyl",
      decade: "2000s",
      sort: "artist",
      page: 4,
      pageSize: 12,
    }),
    {
      view: "pattern",
      query: "ambient",
      format: "vinyl",
      decade: "2000s",
      sort: "artist",
      page: 4,
      pageSize: 12,
    },
  );
});

test("Play overview is provider-free while validated direct routes use closed dispatch", async () => {
  const [page, overview, direct, foundation, screens] = await Promise.all([
    source("app/play/page.tsx"),
    source("components/play/room-platform/RoomOverview.tsx"),
    source("app/play/[objectSlug]/page.tsx"),
    source("lib/server/play-screen-foundation.ts"),
    source("components/play/room-platform/room-screen-registry.ts"),
  ]);
  assert.doesNotMatch(page, /getPublicConnectorSnapshot|getStravaPublicConfig/);
  assert.doesNotMatch(overview, /api\/connectors|getPublicConnector|fetch\(/);
  assert.match(page, /<RoomOverview/);
  assert.match(page, /permanentRedirect\(legacyObject\.route\)/);
  assert.doesNotMatch(page, /ClassicPlayExperience|roomExperienceEnabled/);
  for (const provider of ["myanimelist", "hardcover", "steam"]) {
    assert.match(
      foundation,
      new RegExp(`getCollectionScreenFoundation\\("${provider}"`),
    );
  }
  assert.match(foundation, /satisfies Record<RoomConnectorObjectId, RoomProviderAdapter>/);
  assert.match(direct, /satisfies Record<RoomConnectorObjectId, RoomRouteFoundation>/);
  assert.match(
    direct,
    /object\.contentSource\.kind === "travel-log" && !travelAtlasEnabled\(\)/,
  );
  assert.match(direct, /return ROOM_ROUTE_FOUNDATIONS\[object\.id\]\(query\)/);
  assert.match(screens, /satisfies Record<RoomObjectId, RoomScreenLoader>/);
  for (const screen of [
    "WatchRoomScreen",
    "ReadRoomScreen",
    "ListenRoomScreen",
    "CollectRoomScreen",
    "PlayRoomScreen",
    "MoveRoomScreen",
    "TravelRoomScreen",
  ]) {
    assert.match(screens, new RegExp(`import\\("\\.\\./room-screens/${screen}"\\)`));
  }
  assert.match(direct, /if \(object\.id === "travel"\) notFound\(\)/);
  assert.doesNotMatch(direct, /travel: async|import\(/);
  assert.doesNotMatch(screens, /import\(`|import\([^"']/);
  assert.doesNotMatch(direct, /object\.(provider|meshRoot).*ROOM_/);
});

test("all direct Play routes are no-store publication-backed paths", () => {
  for (const pathname of [
    "/play",
    "/play/watch",
    "/play/read",
    "/play/listen",
    "/play/collect",
    "/play/play",
    "/play/move",
    "/play/travel",
  ]) {
    assert.equal(isPlayPath(pathname), true);
  }
  assert.equal(isPlayPath("/work"), false);
  assert.equal(isPlayPath("/playlist"), false);
});

test("seven authored screens preserve provider, travel, and consent boundaries", async () => {
  const [registry, copy, ...screens] = await Promise.all(
    [
      "../room-platform/room-registry.ts",
      "../../../content/copy/pages/play.md",
      "WatchRoomScreen.tsx",
      "ReadRoomScreen.tsx",
      "ListenRoomScreen.tsx",
      "CollectRoomScreen.tsx",
      "PlayRoomScreen.tsx",
      "MoveRoomScreen.tsx",
      "TravelRoomScreen.tsx",
    ].map((name) =>
      source(
        name.startsWith("../")
          ? `components/play/room-screens/${name}`
          : `components/play/room-screens/${name}`,
      ),
    ),
  );
  const combined = screens.join("\n");
  for (const [id, objectTitle, screenEyebrow, providerId, providerLabel, screenTitle] of [
    ["watch", "TV", "Channel 11", "myanimelist", "MyAnimeList", "Midnight Broadcast"],
    ["read", "Bookshelf", "Shelf light on", "hardcover", "Hardcover", "Bedside Shelf"],
    ["listen", "Music player", "Top Tracks", "spotify", "Spotify", "Pocket Player"],
    ["collect", "Record crate", "Crate 01", "discogs", "Discogs", "Crate Archive"],
    ["play", "Computer", "Desktop 01", "steam", "Steam", "Desktop Library"],
    ["move", "Treadmill", "Cardio feed", "strava", "Strava", "Cardio Television"],
  ]) {
    const structural = roomObjectContract(id);
    assert.equal(structural?.contentSource.kind, "connector");
    assert.equal(structural?.contentSource.provider, providerId);
    assert.match(
      registry,
      new RegExp(
        `${id}: \\{[\\s\\S]*?object: SITE_COPY\\.play\\["${id}-title"\\][\\s\\S]*?screenEyebrow: [^\\n]*SITE_COPY\\.play\\["${id}-screen-eyebrow"\\][^\\n]*${providerLabel}[\\s\\S]*?title: SITE_COPY\\.play\\["${id}-screen-title"\\]`,
      ),
    );
    assert.match(copy, new RegExp(`## ${id}-title\\n${objectTitle}`));
    assert.match(
      copy,
      new RegExp(`## ${id}-screen-eyebrow\\n${screenEyebrow}`),
    );
    assert.match(copy, new RegExp(`## ${id}-screen-title\\n${screenTitle}`));
    assert.notEqual(screenTitle, objectTitle);
  }
  assert.equal(
    screens.reduce(
      (count, screen) => count + (screen.match(/<p>\{object\.screenEyebrow\}<\/p>/g)?.length ?? 0),
      0,
    ),
    7,
  );
  assert.match(copy, /## travel-title\nGlobe/);
  assert.match(copy, /## travel-screen-title\nPostcard Planet/);
  const travel = roomObjectContract("travel");
  assert.deepEqual(travel?.contentSource, { kind: "travel-log" });
  assert.equal(travel?.approachPoseId, "travel-approach");
  assert.equal(travel?.meshRoot, "OBJ__travel");
  assert.match(combined, /provider="myanimelist"/);
  assert.match(combined, /provider="hardcover"/);
  assert.match(combined, /provider="steam"/);
  assert.match(combined, /setShowStrava\(true\)/);
  assert.match(combined, /<DiscogsStream/);
  assert.match(combined, /presentation="crate"/);
  assert.match(combined, /routePath="\/play\/collect"/);
  assert.match(combined, /<PostcardPlanet/);
  assert.doesNotMatch(combined, /from\s+["']three["']|<canvas\b|autoplay/i);
});

test("Watch, Read, and Play have provider-specific semantic appliances", async () => {
  const [watch, read, play, css] = await Promise.all([
    source("components/play/room-screens/WatchRoomScreen.tsx"),
    source("components/play/room-screens/ReadRoomScreen.tsx"),
    source("components/play/room-screens/PlayRoomScreen.tsx"),
    source("components/play/room-screens/RoomScreens.module.css"),
  ]);

  assert.match(watch, /aria-label=\{`\$\{object\.title\} sections`\}/);
  assert.match(watch, /href="#watch-program-note"/);
  assert.match(watch, /href="#watch-library"/);
  assert.match(watch, /data-room-collection-presentation="broadcast-guide"/);

  assert.match(read, /aria-label=\{`\$\{object\.title\} sections`\}/);
  assert.match(read, /href="#read-desk-note"/);
  assert.match(read, /href="#read-library"/);
  assert.match(read, /data-room-collection-presentation="circulation-shelf"/);
  assert.match(read, /<dl>/);

  assert.match(play, /aria-label=\{`\$\{object\.title\} shortcuts`\}/);
  assert.match(play, /href="#play-system-note"/);
  assert.match(play, /href="#play-library"/);
  assert.match(play, /data-room-collection-presentation="desktop-library"/);

  for (const [screen, provider] of [
    [watch, "myanimelist"],
    [read, "hardcover"],
    [play, "steam"],
  ]) {
    assert.match(screen, new RegExp(`provider="${provider}"`));
    assert.match(screen, /<CollectionStream/);
    assert.doesNotMatch(screen, /CollectionGallery|CollectionPattern/);
  }

  assert.match(css, /\.watchProgram ol\[data-provider="myanimelist"\]/);
  assert.match(css, /\.readCatalog ol\[data-provider="hardcover"\]/);
  assert.match(css, /\.desktopProgram ol\[data-provider="steam"\]/);
});

test("each object screen has a distinct cancellable match-cut enhancement", async () => {
  const matchCut = await source(
    "components/play/room-screens/MatchCutSurface.tsx",
  );
  for (const id of ["watch", "read", "listen", "collect", "play", "move", "travel"]) {
    assert.match(matchCut, new RegExp(`^  ${id}: \\{`, "m"));
  }
  assert.match(matchCut, /import \{ animate \} from "animejs"/);
  assert.match(matchCut, /prefers-reduced-motion: reduce/);
  assert.match(matchCut, /animation\.cancel\(\)/);
  assert.match(matchCut, /onComplete: \(\) => \{[\s\S]*element\.removeAttribute\("style"\);[\s\S]*matchCutState = "settled"/);
  assert.doesNotMatch(matchCut, /style=\{preset\.initial\}/);
});

test("Collect defines readable ink directly against its recessed catalog", async () => {
  const css = await source(
    "components/play/room-screens/RoomScreens.module.css",
  );
  const rule = css.match(/\.collectPage\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(rule, "Expected a Collect theme rule");
  const color = (name) => {
    const value = rule.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
    assert.ok(value, `Expected a literal --${name} color`);
    return value;
  };
  const surface = color("paper");
  for (const token of ["ink", "muted", "blue"]) {
    assert.ok(
      contrastRatio(color(token), surface) >= 4.5,
      `Expected --${token} to meet 4.5:1 against the catalog surface`,
    );
  }
  assert.match(css, /\.crateWell\s*\{[\s\S]*var\(--paper\)/);
});

test("Travel trip pages expose bounded semantic page-size controls", async () => {
  const [trip, route] = await Promise.all([
    source("components/play/travel/TravelTripLog.tsx"),
    source("app/play/travel/trips/[slug]/page.tsx"),
  ]);
  assert.match(trip, /const PAGE_SIZES = \[12, 24, 36\] as const/);
  assert.match(trip, /aria-label="Photos per page"/);
  assert.match(trip, /firstVisibleIndex/);
  assert.match(trip, /Math\.min\(requestedPage, maximumPage\)/);
  assert.match(route, /noindex: hasPublicQuery\(query\)/);
  assert.match(route, /\^\[1-9\]\\d\*\$/);
  assert.match(route, /raw === "24"/);
  assert.match(route, /raw === "36"/);
  assert.doesNotMatch(route, /parseInt/);
});
