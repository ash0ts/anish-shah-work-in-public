import manifest from "./diorama.generated.json" with { type: "json" };

/** Measured by the reproducible asset build, excluding invisible hit proxies. */
export const ROOM_RENDER_METRICS = Object.freeze({
  visibleDrawCallUpperBound: manifest.drawCalls,
  materialSlots: manifest.materials,
  visibleTriangleUpperBound: manifest.triangles,
  hitProxyCount: Object.keys(manifest.props).length,
});
export const ROOM_RENDER_BUDGET = Object.freeze({
  visibleDrawCalls: 30, materialSlots: 16, visibleTriangles: 20_000,
});
export const FISHEYE_FRAME_RENDER_BUDGET = Object.freeze({
  actualDrawCalls: 410, actualTriangles: 190_000, cubemapFaces: 6,
});
