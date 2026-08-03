import { ROOM_MATERIAL_SLOT_COUNT } from "./room-materials.ts";

/**
 * Deterministic upper bounds for one render of the procedural room. Invisible
 * hit proxies are not rendered. The fisheye tier renders this scene through six
 * cubemap faces before its final sphere composite.
 */
export const PROCEDURAL_ROOM_RENDER_METRICS = Object.freeze({
  visibleDrawCallUpperBound: 52,
  materialSlots: ROOM_MATERIAL_SLOT_COUNT,
  visibleTriangleUpperBound: 28_000,
  roundedBoxCount: 33,
  instancedDrawCalls: 11,
  repeatedMeshesCollapsed: 56,
  hitProxyCount: 6,
});

export const PROCEDURAL_ROOM_RENDER_BUDGET = Object.freeze({
  visibleDrawCalls: 53,
  materialSlots: 24,
  visibleTriangles: 80_000,
});

export const FISHEYE_FRAME_RENDER_BUDGET = Object.freeze({
  actualDrawCalls: 320,
  actualTriangles: 190_000,
  cubemapFaces: 6,
});
