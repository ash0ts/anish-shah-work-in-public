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

const roomRegistryKeys = (text, name) => {
  const match = text.match(
    new RegExp(
      `${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}(?: as const)? satisfies`,
    ),
  );
  assert.ok(match, `Expected a satisfies-checked literal ${name} registry`);
  return [...match[1].matchAll(/^  (watch|read|listen|collect|play|move):/gm)].map(
    ([, id]) => id,
  );
};

test("the room registry is closed, unique, and maps six routes to six providers", async () => {
  const [types, registry] = await Promise.all([
    source("components/play/room-platform/room-types.ts"),
    source("components/play/room-platform/room-registry.ts"),
  ]);
  assert.match(
    types,
    /ROOM_OBJECT_IDS\s*=\s*\[\s*"watch",\s*"read",\s*"listen",\s*"collect",\s*"play",\s*"move",?\s*\]/,
  );
  for (const [id, provider] of [
    ["watch", "myanimelist"],
    ["read", "hardcover"],
    ["listen", "spotify"],
    ["collect", "discogs"],
    ["play", "steam"],
    ["move", "strava"],
  ]) {
    assert.match(
      registry,
      new RegExp(
        `${id}: \\{[\\s\\S]*?id: "${id}"[\\s\\S]*?route: "/play/${id}"[\\s\\S]*?provider: "${provider}"[\\s\\S]*?meshRoot: "OBJ__${id}"`,
      ),
    );
    assert.match(
      registry,
      new RegExp(`${id}: '\\[data-room-object-link="${id}"\\]'`),
    );
  }
  assert.match(registry, /satisfies RoomObjectRegistry/);
  assert.match(registry, /satisfies RoomFocusTargetRegistry/);
  assert.match(registry, /Record<RoomObjectId, RoomObjectDefinition>/);
  assert.match(registry, /isRoomObjectId\(value: unknown\)/);
  assert.match(registry, /Object\.hasOwn\(ROOM_OBJECT_BY_ID, value\)/);
  assert.match(registry, /return isRoomObjectId\(value\) \? ROOM_OBJECT_BY_ID\[value\] : null/);
  assert.doesNotMatch(registry, /Object\.fromEntries|as Record|includes\(value as/);
});

test("route, screen, provider, object, and focus registries have identical closed keys", async () => {
  const [registry, screens, foundation, route] = await Promise.all([
    source("components/play/room-platform/room-registry.ts"),
    source("components/play/room-platform/room-screen-registry.ts"),
    source("lib/server/play-screen-foundation.ts"),
    source("app/play/[objectSlug]/page.tsx"),
  ]);
  const expected = ["watch", "read", "listen", "collect", "play", "move"];
  for (const [text, name] of [
    [registry, "ROOM_OBJECT_BY_ID"],
    [registry, "ROOM_FOCUS_TARGET_BY_ID"],
    [screens, "ROOM_SCREEN_LOADERS"],
    [foundation, "ROOM_PROVIDER_ADAPTERS"],
    [route, "ROOM_ROUTE_FOUNDATIONS"],
  ]) {
    assert.deepEqual(roomRegistryKeys(text, name), expected, name);
  }
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
  assert.match(provider, /if \(returnWithBrowserHistory\) router\.back\(\)/);
  assert.match(provider, /else \{[\s\S]*routeWithPreviewFixture\([\s\S]*"\/play"/);
  assert.match(provider, /previewFixtureFromSearch\(window\.location\.search\)/);
  assert.match(provider, /notifyRuntimeMounted/);
  assert.match(provider, /const focusObject = useCallback/);
  assert.match(provider, /const resetView = useCallback/);
  assert.match(provider, /const rotate = useCallback/);
  assert.doesNotMatch(provider, /focusObject: \(id\) => dispatch/);
  assert.match(provider, /Opened \$\{object\.label\}: \$\{object\.title\}\./);
  assert.match(provider, /Returned to the room/);
  assert.match(provider, /data-room-return-status/);
  assert.match(provider, /Rewinding to My Room/);
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

test("classic is the fail-safe Play mode", async () => {
  const mode = await source("lib/server/play-experience.ts");
  assert.match(
    mode,
    /return value === "my-room-2001" \? "my-room-2001" : "classic"/,
  );
  assert.match(mode, /runtimeValue\("PLAY_EXPERIENCE_MODE"\)/);
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
  assert.match(page, /roomExperienceEnabled\(\)/);
  assert.match(page, /ClassicPlayExperience/);
  for (const provider of ["myanimelist", "hardcover", "steam"]) {
    assert.match(
      foundation,
      new RegExp(`getCollectionScreenFoundation\\("${provider}"`),
    );
  }
  assert.match(foundation, /satisfies Record<RoomObjectId, RoomProviderAdapter>/);
  assert.match(direct, /satisfies Record<RoomObjectId, RoomRouteFoundation>/);
  assert.match(direct, /return ROOM_ROUTE_FOUNDATIONS\[object\.id\]\(query\)/);
  assert.match(screens, /satisfies Record<RoomObjectId, RoomScreenLoader>/);
  for (const screen of [
    "WatchRoomScreen",
    "ReadRoomScreen",
    "ListenRoomScreen",
    "CollectRoomScreen",
    "PlayRoomScreen",
    "MoveRoomScreen",
  ]) {
    assert.match(screens, new RegExp(`import\\("\\.\\./room-screens/${screen}"\\)`));
  }
  assert.doesNotMatch(direct, /object\.id ===|import\(/);
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
  ]) {
    assert.equal(isPlayPath(pathname), true);
  }
  assert.equal(isPlayPath("/work"), false);
  assert.equal(isPlayPath("/playlist"), false);
});

test("six authored screens preserve provider and consent boundaries", async () => {
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
    ].map((name) =>
      source(
        name.startsWith("../")
          ? `components/play/room-screens/${name}`
          : `components/play/room-screens/${name}`,
      ),
    ),
  );
  const combined = screens.join("\n");
  for (const [id, objectTitle, screenEyebrow, providerLabel, screenTitle] of [
    ["watch", "TV", "Channel 11", "MyAnimeList", "Midnight Broadcast"],
    ["read", "Bookshelf", "Shelf light on", "Hardcover", "Bedside Shelf"],
    ["listen", "Music player", "Top Tracks", "Spotify", "Pocket Player"],
    ["collect", "Record crate", "Crate 01", "Discogs", "Crate Archive"],
    ["play", "Computer", "Desktop 01", "Steam", "Desktop Library"],
    ["move", "Treadmill", "Cardio feed", "Strava", "Cardio Television"],
  ]) {
    assert.match(
      registry,
      new RegExp(
        `${id}: \\{[\\s\\S]*?providerLabel: "${providerLabel}"[\\s\\S]*?object: SITE_COPY\\.play\\["${id}-title"\\][\\s\\S]*?screenEyebrow: [^\\n]*SITE_COPY\\.play\\["${id}-screen-eyebrow"\\][^\\n]*${providerLabel}[\\s\\S]*?title: SITE_COPY\\.play\\["${id}-screen-title"\\]`,
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
    6,
  );
  assert.match(combined, /provider="myanimelist"/);
  assert.match(combined, /provider="hardcover"/);
  assert.match(combined, /provider="steam"/);
  assert.match(combined, /setShowStrava\(true\)/);
  assert.match(combined, /<DiscogsStream/);
  assert.match(combined, /presentation="crate"/);
  assert.match(combined, /routePath="\/play\/collect"/);
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
  for (const id of ["watch", "read", "listen", "collect", "play", "move"]) {
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
