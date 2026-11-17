import manifest from "./diorama.generated.json" with { type: "json" };
import { ROOM_SCENE_OBJECTS } from "./room-scene-layout.ts";
import { buildRigRoomMesh } from "./rig-room-model.ts";

export const RIG_RENDER_METRICS = Object.freeze({
  triangles: buildRigRoomMesh().positions.length / 9, drawCalls: 1, materials: 1,
});

/** Measured by the reproducible asset build, excluding invisible hit proxies. */
export const ROOM_RENDER_METRICS = Object.freeze({
  visibleDrawCallUpperBound: manifest.drawCalls + RIG_RENDER_METRICS.drawCalls,
  materialSlots: manifest.materials + RIG_RENDER_METRICS.materials,
  visibleTriangleUpperBound: manifest.triangles + RIG_RENDER_METRICS.triangles,
  hitProxyCount: Object.keys(ROOM_SCENE_OBJECTS).length,
});
export const ROOM_RENDER_BUDGET = Object.freeze({
  visibleDrawCalls: 30, materialSlots: 16, visibleTriangles: 20_000,
});
export const FISHEYE_FRAME_RENDER_BUDGET = Object.freeze({
  actualDrawCalls: 410, actualTriangles: 190_000, cubemapFaces: 6,
});
