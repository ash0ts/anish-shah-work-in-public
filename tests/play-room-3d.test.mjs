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
  const posterFiles = [
    "my-room-2001-neutral.50f82f186444.avif",
    "my-room-2001-neutral.af662c65ec99.webp",
  ];
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

  for (const filename of posterFiles) {
    const url = new URL(`../public/assets/play/${filename}`, import.meta.url);
    const [bytes, metadata] = await Promise.all([readFile(url), stat(url)]);
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    assert.match(filename, new RegExp(`\\.${digest}\\.`));
    assert.ok(metadata.size <= 200_000);
    assert.match(overview, new RegExp(filename.replaceAll(".", "\\.")));
    assert.match(runtime, new RegExp(filename.replaceAll(".", "\\.")));
  }

  assert.match(overview, /<picture>/);
  assert.match(overview, /alt=""/);
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
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.visibleDrawCallUpperBound, 52);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.materialSlots, 24);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.visibleTriangleUpperBound, 28_000);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.roundedBoxCount, 33);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.instancedDrawCalls, 11);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.repeatedMeshesCollapsed, 56);

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
    "watch-approach",
  ]);
  for (const pose of Object.values(ROOM_APPROACH_POSES)) {
    assert.equal(pose.position.length, 3);
    assert.ok(pose.scale >= 1 && pose.scale <= 1.35);
    assert.ok(Math.abs(pose.yawDeg) <= 5);
  }
});
