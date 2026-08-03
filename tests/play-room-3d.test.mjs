import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  evaluateRoomCapability,
  ROOM_MINIMUM_VIEWPORT_WIDTH,
} from "../components/play/room-3d/room-capability.ts";
import {
  clampRoomRotation,
  crossedRoomDragThreshold,
  ROOM_DRAG_THRESHOLD_PX,
  rotationFromPointerDelta,
} from "../components/play/room-3d/room-math.ts";
import {
  PROCEDURAL_ROOM_RENDER_BUDGET,
  PROCEDURAL_ROOM_RENDER_METRICS,
} from "../components/play/room-3d/room-render-metrics.ts";
import { ROOM_APPROACH_POSES } from "../components/play/room-3d/room-approach.ts";
import {
  isCompetingRoomPointer,
  isRoomInteractivePointer,
} from "../components/play/room-3d/room-pointer-policy.ts";

const capableEnvironment = {
  viewportWidth: ROOM_MINIMUM_VIEWPORT_WIDTH,
  finePointer: true,
  reducedMotion: false,
  forcedColors: false,
  zoomScale: 1,
  saveData: false,
  documentVisible: true,
  webgl2Available: true,
};

test("room capability fails closed for every ineligible environment", () => {
  assert.deepEqual(evaluateRoomCapability(capableEnvironment), {
    eligible: true,
    reasons: [],
  });

  const cases = [
    ["viewportWidth", ROOM_MINIMUM_VIEWPORT_WIDTH - 1, "narrow-viewport"],
    ["finePointer", false, "coarse-pointer"],
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
    assert.deepEqual(result.reasons, [reason]);
  }
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

test("room pointer policy reserves WebGL gestures for one mouse or pen", () => {
  assert.equal(isRoomInteractivePointer("mouse"), true);
  assert.equal(isRoomInteractivePointer("pen"), true);
  assert.equal(isRoomInteractivePointer("touch"), false);
  assert.equal(isRoomInteractivePointer(""), false);
  assert.equal(isCompetingRoomPointer(null, 2), false);
  assert.equal(isCompetingRoomPointer(2, 2), false);
  assert.equal(isCompetingRoomPointer(2, 3), true);
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
  assert.match(stage, /data-projection="wide-perspective"/);
  assert.match(stage, /fov: 38/);
  assert.match(stage, /position: \[6\.05, 4\.7, 7\.05\]/);
  assert.match(stage, /setClearColor\(ROOM_PALETTE\.backdrop, 1\)/);
  assert.doesNotMatch(stage, /Fisheye|fisheye/);
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
  assert.match(controller, /usePathname/);
  assert.doesNotMatch(controller, /onClick=/);
});

test("the static room poster is first-party, content-hashed, and bounded", async () => {
  const posterFiles = [
    "my-room-2001-neutral.ef2efa0dfd41.avif",
    "my-room-2001-neutral.9a4abb831261.webp",
  ];
  const overview = await readFile(
    new URL(
      "../components/play/room-platform/RoomOverview.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  for (const filename of posterFiles) {
    const url = new URL(`../public/assets/play/${filename}`, import.meta.url);
    const [bytes, metadata] = await Promise.all([readFile(url), stat(url)]);
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    assert.match(filename, new RegExp(`\\.${digest}\\.`));
    assert.ok(metadata.size <= 200_000);
    assert.match(overview, new RegExp(filename.replaceAll(".", "\\.")));
  }

  assert.match(overview, /<picture>/);
  assert.match(overview, /alt=""/);
  assert.doesNotMatch(overview, /https?:\/\//);
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
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.visibleDrawCallUpperBound, 40);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.materialSlots, 23);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.visibleTriangleUpperBound, 20_196);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.instancedDrawCalls, 8);
  assert.equal(PROCEDURAL_ROOM_RENDER_METRICS.repeatedMeshesCollapsed, 32);

  const objects = await readFile(
    new URL(
      "../components/play/room-3d/RoomProceduralObjects.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal((objects.match(/<SoftBox/g) ?? []).length, 26);
  assert.equal((objects.match(/<Instances/g) ?? []).length, 8);
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
