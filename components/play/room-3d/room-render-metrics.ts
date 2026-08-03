import { ROOM_MATERIAL_SLOT_COUNT } from "./room-materials.ts";

/**
 * Deterministic upper bounds for the shipped wide-perspective procedural room.
 * Invisible hit proxies are not rendered.
 */
export const PROCEDURAL_ROOM_RENDER_METRICS = Object.freeze({
  visibleDrawCallUpperBound: 40,
  materialSlots: ROOM_MATERIAL_SLOT_COUNT,
  visibleTriangleUpperBound: 20_196,
  roundedBoxCount: 26,
  instancedDrawCalls: 8,
  repeatedMeshesCollapsed: 32,
  hitProxyCount: 6,
});

export const PROCEDURAL_ROOM_RENDER_BUDGET = Object.freeze({
  visibleDrawCalls: 50,
  materialSlots: 24,
  visibleTriangles: 80_000,
});
