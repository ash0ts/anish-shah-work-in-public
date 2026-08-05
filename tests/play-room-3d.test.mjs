import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { BoxGeometry, Mesh, MeshBasicMaterial, Ray, Vector3 } from "three";

import {
  collectViteStaticDependencyClosure,
  findViteManifestEntryBySource,
  subtractManifestFiles,
} from "../scripts/lib/vite-manifest-closure.mjs";

import {
  evaluateRoomCapability,
  POCKET_ROOM_MINIMUM_VIEWPORT_HEIGHT,
  POCKET_ROOM_MINIMUM_VIEWPORT_WIDTH,
  ROOM_MINIMUM_VIEWPORT_WIDTH,
} from "../components/play/room-3d/room-capability.ts";
import {
  adjacentPocketRoomRotation,
  clampRoomRotation,
  crossedRoomDragThreshold,
  POCKET_ROOM_DRAG_THRESHOLD_PX,
  rotationFromPocketPointerDelta,
  ROOM_DRAG_THRESHOLD_PX,
  rotationFromPointerDelta,
  snapPocketRoomRotation,
} from "../components/play/room-3d/room-math.ts";
import {
  FISHEYE_FRAME_RENDER_BUDGET,
  PROCEDURAL_ROOM_RENDER_BUDGET,
  PROCEDURAL_ROOM_RENDER_METRICS,
} from "../components/play/room-3d/room-render-metrics.ts";
import { ROOM_APPROACH_POSES } from "../components/play/room-3d/room-approach.ts";
import {
  createFisheyeHealthState,
  recordCompletedFisheyeFrame,
} from "../components/play/room-3d/room-fisheye-health.ts";
import {
  isCompetingRoomPointer,
  isRoomInteractivePointer,
} from "../components/play/room-3d/room-pointer-policy.ts";
import { resolveRoomRayHit } from "../components/play/room-3d/room-hit-resolution.ts";
import {
  conservativeTravelZoomScale,
  evaluateTravelGlobeCapability,
} from "../components/play/travel/travel-globe-capability.ts";
import {
  countryTexturePixel,
  crossedTravelGlobeDragThreshold,
  latLngToVector3,
  resolveTravelGlobeGesture,
  TRAVEL_GLOBE_COUNTRY_SURFACE_YAW,
  travelGlobeSurfaceLongitudeFromTextureU,
  travelGlobeSurfaceQuaternion,
  travelRegionTripCounts,
  TRAVEL_GLOBE_DRAG_THRESHOLD_PX,
  vector3ToLatLng,
} from "../components/play/travel/travel-globe-math.ts";

const capableEnvironment = {
  viewportWidth: ROOM_MINIMUM_VIEWPORT_WIDTH,
  viewportHeight: 900,
  finePointer: true,
  reducedMotion: false,
  forcedColors: false,
  zoomScale: 1,
  saveData: false,
  documentVisible: true,
  webgl2Available: true,
};
const ROOM_RENDERER_GZIP_OPTIMIZATION_TARGET_BYTES = 225 * 1024;
const ROOM_RENDERER_GZIP_HARD_CEILING_BYTES = 325 * 1024;

test("room capability fails closed for every ineligible environment", () => {
  assert.deepEqual(evaluateRoomCapability(capableEnvironment), {
    eligible: true,
    tier: "desktop-fisheye",
    reasons: [],
  });

  const cases = [
    [
      "viewportWidth",
      POCKET_ROOM_MINIMUM_VIEWPORT_WIDTH - 1,
      "narrow-viewport",
    ],
    ["reducedMotion", true, "reduced-motion"],
    ["forcedColors", true, "forced-colors"],
    ["zoomScale", 2, "zoomed"],
    ["saveData", true, "save-data"],
    ["documentVisible", false, "document-hidden"],
    ["webgl2Available", false, "webgl2-unavailable"],
  ];

  for (const [key, value, reason] of cases) {
    const result = evaluateRoomCapability({
      ...capableEnvironment,
      [key]: value,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.tier, "static");
    assert.deepEqual(result.reasons, [reason]);
  }

  assert.deepEqual(
    evaluateRoomCapability({
      ...capableEnvironment,
      viewportWidth: 390,
      viewportHeight: 844,
      finePointer: false,
    }),
    { eligible: true, tier: "pocket", reasons: [] },
  );

  assert.deepEqual(
    evaluateRoomCapability({ ...capableEnvironment, finePointer: false }),
    { eligible: true, tier: "pocket", reasons: [] },
  );

  assert.deepEqual(
    evaluateRoomCapability({
      ...capableEnvironment,
      viewportWidth: 390,
      viewportHeight: POCKET_ROOM_MINIMUM_VIEWPORT_HEIGHT - 1,
      finePointer: false,
    }),
    { eligible: false, tier: "static", reasons: ["narrow-viewport"] },
  );

  assert.deepEqual(
    evaluateRoomCapability({
      ...capableEnvironment,
      viewportHeight: POCKET_ROOM_MINIMUM_VIEWPORT_HEIGHT - 1,
    }),
    { eligible: true, tier: "desktop-fisheye", reasons: [] },
    "A short desktop window keeps the existing desktop room",
  );
});

test("room pointer math preserves the eight-pixel click dead zone", () => {
  assert.equal(
    crossedRoomDragThreshold([0, 0], [ROOM_DRAG_THRESHOLD_PX, 0]),
    false,
  );
  assert.equal(
    crossedRoomDragThreshold([0, 0], [ROOM_DRAG_THRESHOLD_PX + 0.01, 0]),
    true,
  );
});

test("pocket room gestures use a larger dead zone and three authored stops", () => {
  assert.equal(
    crossedRoomDragThreshold(
      [0, 0],
      [POCKET_ROOM_DRAG_THRESHOLD_PX, 0],
      POCKET_ROOM_DRAG_THRESHOLD_PX,
    ),
    false,
  );
  assert.deepEqual(rotationFromPocketPointerDelta({ x: 4, y: 0 }, 80), {
    x: 0,
    y: 12,
  });
  assert.deepEqual(snapPocketRoomRotation({ x: 3, y: -7 }), {
    x: 0,
    y: -12,
  });
  assert.deepEqual(adjacentPocketRoomRotation({ x: 0, y: 0 }, -1), {
    x: 0,
    y: -12,
  });
  assert.deepEqual(adjacentPocketRoomRotation({ x: 0, y: 12 }, 1), {
    x: 0,
    y: 12,
  });
});

test("travel globe math preserves geography and the eight-pixel drag threshold", () => {
  for (const [lat, lng] of [
    [0, 0],
    [40.7, -74],
    [-33.9, 151.2],
    [64.1, -21.9],
  ]) {
    const roundTrip = vector3ToLatLng(latLngToVector3(lat, lng));
    assert.ok(Math.abs(roundTrip.lat - lat) < 0.000_001);
    assert.ok(Math.abs(roundTrip.lng - lng) < 0.000_001);
  }
  assert.equal(
    crossedTravelGlobeDragThreshold(
      [0, 0],
      [TRAVEL_GLOBE_DRAG_THRESHOLD_PX, 0],
    ),
    false,
  );
  assert.equal(
    crossedTravelGlobeDragThreshold(
      [0, 0],
      [TRAVEL_GLOBE_DRAG_THRESHOLD_PX + 0.01, 0],
    ),
    true,
  );
  for (let index = 0; index < 20; index += 1) {
    assert.deepEqual(
      resolveTravelGlobeGesture(
        false,
        [index, index * 2],
        [index + TRAVEL_GLOBE_DRAG_THRESHOLD_PX + 1, index * 2],
      ),
      { dragged: true, suppressSelection: true },
      `pin-origin drag ${index + 1} must cross the shared selection guard`,
    );
  }
  assert.deepEqual(countryTexturePixel(90, -180, 1024, 512), [0, 0]);
  assert.deepEqual(countryTexturePixel(-90, 179.999, 1024, 512), [1023, 511]);
});

test("travel globe country surface aligns the rendered map with pins and click decoding", () => {
  // Three SphereGeometry places the texture's prime meridian 90 degrees east
  // of the geographic +Z meridian used by pins and CPU click sampling. Rotate
  // only that UV-bearing surface so every equirectangular longitude lands on
  // its matching geographic point.
  assert.equal(TRAVEL_GLOBE_COUNTRY_SURFACE_YAW, -Math.PI / 2);
  for (const longitude of [-180, 0, -74.006, 139.6917, 179.999, 180]) {
    const textureU = (longitude + 180) / 360;
    const rendered = travelGlobeSurfaceLongitudeFromTextureU(textureU);
    assert.ok(Math.abs(rendered - longitude) < 0.000_001);
  }

  const tokyo = latLngToVector3(35.6762, 139.6503).normalize();
  const haloNormal = new Vector3(0, 0, 1).applyQuaternion(
    travelGlobeSurfaceQuaternion(35.6762, 139.6503),
  );
  assert.ok(haloNormal.distanceTo(tokyo) < 0.000_001);
});

test("travel region counts remain scoped to the selected country", () => {
  const counts = travelRegionTripCounts(
    [
      {
        places: [
          { countryCode: "US", admin1Code: "13" },
          { countryCode: "US", admin1Code: "13" },
        ],
      },
      { places: [{ countryCode: "JP", admin1Code: "13" }] },
      { places: [{ countryCode: "US", admin1Code: "CA" }] },
    ],
    "US",
  );
  assert.deepEqual([...counts], [["13", 1], ["CA", 1]]);
});

test("travel globe capability keeps complete accessibility fallbacks", () => {
  const capable = {
    reducedMotion: false,
    forcedColors: false,
    saveData: false,
    zoomScale: 1,
    webgl2Available: true,
  };
  assert.deepEqual(evaluateTravelGlobeCapability(capable), {
    eligible: true,
    reasons: [],
  });
  for (const [key, value, reason] of [
    ["reducedMotion", true, "reduced-motion"],
    ["forcedColors", true, "forced-colors"],
    ["saveData", true, "save-data"],
    ["zoomScale", 2, "high-zoom"],
    ["webgl2Available", false, "webgl2-unavailable"],
  ]) {
    assert.deepEqual(evaluateTravelGlobeCapability({ ...capable, [key]: value }), {
      eligible: false,
      reasons: [reason],
    });
  }
  assert.equal(
    conservativeTravelZoomScale({
      visualScale: 1,
      outerWidth: 1440,
      innerWidth: 720,
      coarsePrimaryPointer: false,
    }),
    2,
  );
  assert.equal(
    conservativeTravelZoomScale({
      visualScale: 1,
      outerWidth: 780,
      innerWidth: 390,
      coarsePrimaryPointer: true,
    }),
    1,
  );
  assert.equal(
    conservativeTravelZoomScale({
      visualScale: 2.5,
      outerWidth: 780,
      innerWidth: 390,
      coarsePrimaryPointer: true,
    }),
    2.5,
  );
});

test("Postcard Planet is demand-driven, pixel-bordered, and semantically navigable", async () => {
  const [planet, stage, gate, noScriptAtlas] = await Promise.all([
    readFile(
      new URL("../components/play/travel/PostcardPlanet.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/play/travel/TravelGlobeStage.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/play/travel/TravelGlobeGate.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/play/travel/TravelNoScriptAtlas.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(stage, /frameloop="demand"/);
  assert.match(stage, /dpr=\{\[1, 1\.5\]\}/);
  assert.match(stage, /idTexel/);
  assert.match(stage, /countryEdge = step\(0\.5 \/ 255\.0, neighborDelta\)/);
  assert.match(stage, /mix\(shaded, borderInk, countryEdge \* 0\.82\)/);
  assert.match(stage, /resolveTravelGlobeGesture/);
  assert.match(stage, /webglcontextlost/);
  assert.match(stage, /lostpointercapture/);
  assert.match(stage, /visibilitychange/);
  assert.match(stage, /if \(material && sampler && readyFrames\.current < 2\)/);
  assert.match(stage, /onTextureFailure/);
  assert.match(stage, /const PIN_HIT_RADIUS = 0\.1;/);
  assert.match(stage, /const PIN_VISUAL_RADIUS = 0\.035;/);
  assert.match(
    stage,
    /const PIN_VISUAL_SCALE = PIN_VISUAL_RADIUS \/ PIN_HIT_RADIUS;/,
  );
  assert.match(stage, /position \* \$\{PIN_VISUAL_SCALE\.toFixed\(2\)\}/);
  assert.match(stage, /<sphereGeometry args=\{\[PIN_HIT_RADIUS, 8, 6\]\}/);
  assert.match(
    stage,
    /rotation=\{\[0, TRAVEL_GLOBE_COUNTRY_SURFACE_YAW, 0\]\}/,
  );
  assert.match(stage, /quaternion=\{selectedPlaceMarker\.quaternion\}/);
  assert.match(stage, /data-travel-globe-hovered-place/);
  assert.match(stage, /if \(pinching\.current\) \{[\s\S]*?cancelGesture\(\)/);
  assert.match(
    stage,
    /<group[\s\S]*?onPointerCancel=\{cancelDrag\}[\s\S]*?onPointerDown=\{startDrag\}[\s\S]*?onPointerMove=\{drag\}[\s\S]*?onPointerUp=\{endDrag\}/,
  );
  assert.equal((stage.match(/if \(consumeSelectionSuppression\(\)\)/g) ?? []).length, 1);
  assert.match(stage, /pressedPlaceId\.current === place\.id/);
  assert.doesNotMatch(stage, /hoveredPlaceId\.current === place\.id/);
  assert.match(stage, /pointer-up ray intersects[\s\S]*?recorded pointer-down identity/);
  assert.match(stage, /if \(shouldSelect\) onSelectPlace\(place\.id\)/);
  assert.match(stage, /boundaryLayers\(admin1, atlas, selectedRegionCode\)/);
  assert.match(stage, /"selected", SELECTED_REGION/);
  assert.match(stage, /count >= 3[\s\S]*?"3\+"/);
  assert.doesNotMatch(stage, /onWheel|wheel|OrbitControls|autoRotate/);
  assert.doesNotMatch(stage, /wireframe/);
  assert.match(planet, /data-travel-atlas-back/);
  assert.match(planet, /data-travel-place-inspector/);
  assert.match(planet, /geography\.countries\.map/);
  assert.match(planet, /tripCount: 0/);
  assert.match(planet, />World<\/button>/);
  assert.match(planet, /aria-label="Reset globe view"/);
  assert.match(planet, /Map boundaries from/);
  assert.match(planet, /Natural Earth/);
  assert.match(planet, /handleGlobeFailure/);
  assert.match(planet, /restoreDirectoryFocus/);
  assert.match(planet, /<img/);
  assert.doesNotMatch(planet, /Canvas|TextureLoader|from "three"/);
  assert.match(gate, /requestAnimationFrame/);
  assert.doesNotMatch(gate, /innerWidth\s*(?:<|>)|pointer: fine|hover: hover/);
  assert.match(noScriptAtlas, /<noscript>/);
  assert.match(noScriptAtlas, /Published travel countries/);
  assert.match(noScriptAtlas, /const pathname = `\/play\/travel\/trips\/\$\{slug\}`/);
  assert.match(noScriptAtlas, /href=\{tripHref\(trip\.slug, previewFixture\)\}/);
});

test("room pointer policy reserves WebGL gestures for one mouse or pen", () => {
  assert.equal(isRoomInteractivePointer("mouse"), true);
  assert.equal(isRoomInteractivePointer("pen"), true);
  assert.equal(isRoomInteractivePointer("touch"), false);
  assert.equal(isRoomInteractivePointer("touch", true), true);
  assert.equal(isRoomInteractivePointer(""), false);
  assert.equal(isCompetingRoomPointer(null, 2), false);
  assert.equal(isCompetingRoomPointer(2, 2), false);
  assert.equal(isCompetingRoomPointer(2, 3), true);
});

test("room hit resolution accepts only the nearest unoccluded object", () => {
  const material = new MeshBasicMaterial();
  const geometry = new BoxGeometry(1, 1, 1);
  const target = new Mesh(geometry, material);
  target.position.z = -4;
  target.userData.roomObjectId = "watch";
  target.updateMatrixWorld(true);

  const occluder = new Mesh(geometry, material);
  occluder.position.z = -2;
  occluder.userData.roomOccluder = true;
  occluder.updateMatrixWorld(true);

  const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
  assert.equal(resolveRoomRayHit(ray, [target], []), "watch");
  assert.equal(resolveRoomRayHit(ray, [target], [occluder]), null);

  occluder.position.z = -6;
  occluder.updateMatrixWorld(true);
  assert.equal(resolveRoomRayHit(ray, [target], [occluder]), "watch");

  geometry.dispose();
  material.dispose();
});

test("room presentation rotation clamps to reviewed bounds", () => {
  assert.deepEqual(clampRoomRotation({ x: -100, y: 100 }), {
    x: -7,
    y: 12,
  });
  assert.deepEqual(rotationFromPointerDelta({ x: 0, y: 0 }, 1000, 1000), {
    x: 7,
    y: 12,
  });
});

test("room renderer remains demand-driven, procedural, and first-party", async () => {
  const [stage, objects, controller] = await Promise.all([
    readFile(
      new URL("../components/play/room-3d/RoomStage.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../components/play/room-3d/RoomProceduralObjects.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../components/play/room-3d/RoomInteractionController.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(stage, /frameloop="demand"/);
  assert.match(stage, /dpr=\{\[1, 1\.25\]\}/);
  assert.match(stage, /data-projection=\{projection\}/);
  assert.match(stage, /fov: 46/);
  assert.match(stage, /position: \[4\.8, 4\.3, 5\.5\]/);
  assert.match(stage, /setClearColor\(ROOM_PALETTE\.backdrop, 1\)/);
  assert.match(stage, /function ResponsiveFisheye/);
  assert.match(stage, /key=\{sizeKey\}/);
  assert.match(stage, /<ResponsiveFisheye>\{roomScene\}<\/ResponsiveFisheye>/);
  assert.match(stage, /resolution=\{640\}/);
  assert.match(stage, /segments=\{32\}/);
  assert.match(stage, /zoom=\{0\.72\}/);
  assert.match(stage, /<FisheyeFrameMonitor/);
  assert.match(stage, /window\.setTimeout\([\s\S]*downgradeProjection,[\s\S]*2_000/);
  assert.match(stage, /"fisheye" \| "wide-perspective"/);
  assert.match(stage, /sessionStorage\.setItem\(FISHEYE_SESSION_DOWNGRADE_KEY/);
  assert.match(stage, /ROOM_OBJECT_BY_ID\[selectedId\]\.approachPoseId/);
  assert.match(stage, /webglcontextlost/);
  assert.match(stage, /failIfMajorPerformanceCaveat: true/);
  assert.doesNotMatch(`${stage}\n${objects}`, /https?:\/\//);
  assert.doesNotMatch(`${stage}\n${objects}`, /useGLTF|\.glb|TextureLoader/);

  const hitIds = [...objects.matchAll(/<HitTarget\s+\n?\s*id="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(hitIds.sort(), [
    "collect",
    "listen",
    "move",
    "play",
    "read",
    "travel",
    "watch",
  ]);
  assert.match(controller, /crossedRoomDragThreshold/);
  assert.match(controller, /isRoomInteractivePointer/);
  assert.match(controller, /isCompetingRoomPointer/);
  assert.match(controller, /visibilitychange/);
  assert.match(controller, /onLostPointerCapture/);
  assert.match(controller, /target instanceof Element/);
  assert.match(controller, /onRotationPreview\(nextView\)/);
  assert.match(controller, /snapPocketRoomRotation\(current\.latestView\)/);
  assert.match(controller, /: current\.latestView/);
  assert.match(controller, /resumeHoverFromRelease/);
  assert.match(controller, /usePathname/);
  assert.match(controller, /resolveRoomRayHit/);
  assert.doesNotMatch(controller, /onClick=/);
  assert.match(objects, /roomOccluder = true/);
  assert.match(objects, /interactionTarget: ReactNode/);
  assert.match(objects, /\{interactionTarget\}[\s\S]*ref=\{visual\}/);
  assert.ok((objects.match(/<Occluder/g) ?? []).length >= 3);
  assert.equal(FISHEYE_FRAME_RENDER_BUDGET.cubemapFaces, 6);
  assert.ok(
    FISHEYE_FRAME_RENDER_BUDGET.actualDrawCalls >
      PROCEDURAL_ROOM_RENDER_BUDGET.visibleDrawCalls,
  );
});

test("pocket renderer is a separate intent-loaded perspective stage", async () => {
  const [runtime, runtimeStyles, overviewStyles, pocket, desktop] = await Promise.all([
    readFile(
      new URL(
        "../components/play/room-platform/RoomRuntime.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../components/play/room-platform/RoomRuntime.module.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../components/play/room-platform/RoomOverview.module.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../components/play/room-3d/PocketRoomStage.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/play/room-3d/RoomStage.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(runtime, /import\("\.\.\/room-3d\/PocketRoomStage"\)/);
  assert.match(runtime, /import\("\.\.\/room-3d\/RoomStage"\)/);
  assert.match(runtime, /capability\.tier === "pocket"/);
  assert.match(runtime, /type PocketEntryPhase = "opening" \| "placing" \| "ready"/);
  assert.match(runtime, /duration: 520/);
  assert.match(runtime, /data-pocket-entry-phase/);
  assert.match(runtimeStyles, /pocket-frame-fold 520ms/);
  assert.match(runtimeStyles, /pocket-dock-rise 130ms/);
  assert.match(overviewStyles, /@media \(max-width: 1099px\)/);
  assert.match(overviewStyles, /clamp\(15rem, 44svh, 24rem\)/);
  assert.match(pocket, /data-projection="pocket-perspective"/);
  assert.match(pocket, /dpr=\{\[1, 1\.15\]\}/);
  assert.match(pocket, /frameloop="demand"/);
  assert.match(pocket, /presentation="pocket"/);
  assert.match(pocket, /failIfMajorPerformanceCaveat: true/);
  assert.match(pocket, /duration > 33/);
  assert.match(pocket, /}, 450\)/);
  assert.match(pocket, /}, 520\)/);
  assert.doesNotMatch(pocket, /Fisheye|postprocessing|OrbitControls/);
  assert.match(desktop, /<ResponsiveFisheye>/);
});

test("fisheye health ignores warmup and downgrades only after sustained misses", () => {
  let state = createFisheyeHealthState();
  for (const duration of [90, 80, 70, 60]) {
    ({ state } = recordCompletedFisheyeFrame(state, duration));
  }
  assert.equal(state.samples.length, 0);

  for (const duration of [16, 18, 60, 17, 19]) {
    const result = recordCompletedFisheyeFrame(state, duration);
    state = result.state;
    assert.equal(result.downgrade, false);
  }

  state = createFisheyeHealthState();
  for (const duration of [16, 16, 16, 16, 40, 42]) {
    ({ state } = recordCompletedFisheyeFrame(state, duration));
  }
  const degraded = recordCompletedFisheyeFrame(state, 41);
  assert.equal(degraded.downgrade, true);
  assert.equal(
    recordCompletedFisheyeFrame(degraded.state, 90).downgrade,
    false,
  );

  state = createFisheyeHealthState();
  for (const duration of [16, 16, 16, 16, 55]) {
    ({ state } = recordCompletedFisheyeFrame(state, duration));
  }
  assert.equal(recordCompletedFisheyeFrame(state, 56).downgrade, true);
});

test("the static room poster is first-party, content-hashed, and bounded", async () => {
  const [overview, runtime] = await Promise.all([
    readFile(
      new URL(
        "../components/play/room-platform/RoomOverview.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../components/play/room-platform/RoomRuntime.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const posterFiles = [
    {
      filename: "my-room-2001-neutral.01c6f825bbc1.avif",
      surfaces: [overview, runtime],
    },
    {
      filename: "my-room-2001-neutral.00d2bc80d8dc.webp",
      surfaces: [overview, runtime],
    },
    {
      filename: "my-room-2001-neutral-mobile.27b17548d9bf.avif",
      surfaces: [overview],
    },
    {
      filename: "my-room-2001-neutral-mobile.95603956f4ee.webp",
      surfaces: [overview],
    },
  ];

  for (const { filename, surfaces } of posterFiles) {
    const url = new URL(`../public/assets/play/${filename}`, import.meta.url);
    const [bytes, metadata] = await Promise.all([readFile(url), stat(url)]);
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    assert.match(filename, new RegExp(`\\.${digest}\\.`));
    assert.ok(metadata.size <= 200_000);
    for (const surface of surfaces) {
      assert.match(surface, new RegExp(filename.replaceAll(".", "\\.")));
    }
  }

  assert.match(overview, /<picture>/);
  assert.match(overview, /alt=""/);
  assert.match(overview, /fetchPriority="high"/);
  assert.match(overview, /media="\(max-width: 767px\)"/);
  assert.doesNotMatch(overview, /https?:\/\//);
});

test("Vite manifest closure traversal includes transitive static files once", () => {
  const manifest = {
    "src/RoomStage.tsx": {
      file: "assets/RoomStage.js",
      src: "src/RoomStage.tsx",
      imports: ["_three.js", "_shared.js"],
      dynamicImports: ["src/OptionalInspector.tsx"],
      css: ["assets/RoomStage.css"],
    },
    "_three.js": {
      file: "assets/three.js",
      imports: ["_shared.js"],
    },
    "_shared.js": {
      file: "assets/shared.js",
      assets: ["assets/shared.bin"],
    },
    "src/OptionalInspector.tsx": {
      file: "assets/OptionalInspector.js",
    },
  };
  const entryKey = findViteManifestEntryBySource(
    manifest,
    "src/RoomStage.tsx",
  );
  const closure = collectViteStaticDependencyClosure(manifest, entryKey);

  assert.deepEqual([...closure.entryKeys].sort(), [
    "_shared.js",
    "_three.js",
    "src/RoomStage.tsx",
  ]);
  assert.deepEqual([...closure.files].sort(), [
    "assets/RoomStage.css",
    "assets/RoomStage.js",
    "assets/shared.bin",
    "assets/shared.js",
    "assets/three.js",
  ]);
  assert.deepEqual(
    [...subtractManifestFiles(closure.files, new Set(["assets/shared.js"]))]
      .sort(),
    [
      "assets/RoomStage.css",
      "assets/RoomStage.js",
      "assets/shared.bin",
      "assets/three.js",
    ],
  );
});

test("the deferred room renderer reports its target and stays below its hard ceiling", async () => {
  const client = new URL("../dist/client/", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL(".vite/manifest.json", client), "utf8"),
  );
  const stageKey = findViteManifestEntryBySource(
    manifest,
    "components/play/room-3d/RoomStage.tsx",
  );
  const runtimeKey = findViteManifestEntryBySource(
    manifest,
    "components/play/room-platform/RoomRuntime.tsx",
  );
  const stageClosure = collectViteStaticDependencyClosure(manifest, stageKey);
  const runtimeClosure = collectViteStaticDependencyClosure(
    manifest,
    runtimeKey,
  );
  const deferredFiles = subtractManifestFiles(
    stageClosure.files,
    runtimeClosure.files,
  );

  assert.ok(stageClosure.entryKeys.size > 1);
  assert.ok(stageClosure.files.size > 1);
  assert.ok(deferredFiles.has(manifest[stageKey].file));

  let gzipBytes = 0;
  for (const outputFile of deferredFiles) {
    gzipBytes += gzipSync(await readFile(new URL(outputFile, client))).byteLength;
  }
  assert.ok(
    ROOM_RENDERER_GZIP_OPTIMIZATION_TARGET_BYTES <
      ROOM_RENDERER_GZIP_HARD_CEILING_BYTES,
  );
  assert.ok(
    gzipBytes <= ROOM_RENDERER_GZIP_HARD_CEILING_BYTES,
    `Deferred RoomStage manifest closure is ${gzipBytes} gzip bytes (optimization target ${ROOM_RENDERER_GZIP_OPTIMIZATION_TARGET_BYTES}; hard ceiling ${ROOM_RENDERER_GZIP_HARD_CEILING_BYTES})`,
  );
});

test("procedural scene stays inside reviewed draw and material budgets", async () => {
  assert.ok(
    PROCEDURAL_ROOM_RENDER_METRICS.visibleDrawCallUpperBound <=
      PROCEDURAL_ROOM_RENDER_BUDGET.visibleDrawCalls,
  );
  assert.ok(
    PROCEDURAL_ROOM_RENDER_METRICS.materialSlots <=
      PROCEDURAL_ROOM_RENDER_BUDGET.materialSlots,
  );
  assert.ok(
    PROCEDURAL_ROOM_RENDER_METRICS.visibleTriangleUpperBound <=
      PROCEDURAL_ROOM_RENDER_BUDGET.visibleTriangles,
  );
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.visibleDrawCallUpperBound, 66);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.materialSlots, 24);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.visibleTriangleUpperBound, 31_000);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.roundedBoxCount, 33);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.instancedDrawCalls, 11);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.repeatedMeshesCollapsed, 56);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.hitProxyCount, 7);

  const objects = await readFile(
    new URL(
      "../components/play/room-3d/RoomProceduralObjects.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal((objects.match(/<SoftBox/g) ?? []).length, 33);
  assert.equal((objects.match(/<Instances/g) ?? []).length, 11);
  assert.doesNotMatch(objects, /<mesh(?:Standard|Basic)Material/);
});

test("every registered object has one authored approach pose", () => {
  assert.deepEqual(Object.keys(ROOM_APPROACH_POSES).sort(), [
    "collect-approach",
    "listen-approach",
    "move-approach",
    "play-approach",
    "read-approach",
    "travel-approach",
    "watch-approach",
  ]);
  for (const pose of Object.values(ROOM_APPROACH_POSES)) {
    assert.equal(pose.position.length, 3);
    assert.ok(pose.scale >= 1 && pose.scale <= 1.35);
    assert.ok(Math.abs(pose.yawDeg) <= 5);
  }
});
