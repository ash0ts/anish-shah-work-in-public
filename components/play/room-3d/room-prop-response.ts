import type { RoomObjectId } from "../room-platform/room-types";

/** Bounded, reversible responses around the physical pivots in the authored GLB. */
export function roomPropResponse(id: RoomObjectId, progress: number) {
  const t = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return {
    offsetY: id === "listen" ? -.025 * t : 0,
    offsetZ: id === "read" ? .2 * t : 0,
    yaw: id === "collect" ? -.6 * t : id === "travel" ? Math.PI * .7 * t : 0,
    visible: id === "watch" || id === "play" || id === "move" ? t > .05 : true,
    scale: 1 + .012 * t,
  };
}
