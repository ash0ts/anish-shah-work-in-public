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

/** A small, reversible glance; no clock, idle animation, or extra hit target. */
export function roomFamiliarPose(horizontalOffset: number | null) {
  const direction = horizontalOffset !== null && Number.isFinite(horizontalOffset)
    ? Math.max(-1, Math.min(1, horizontalOffset / 4)) : 0;
  return { yaw: direction * .45, roll: -direction * .08 };
}

/** Snap to a settled pose so the demand renderer stops invalidating frames. */
export function settleRoomPose(current: number, target: number, delta: number) {
  const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, .05)) : 0;
  const next = target + (current - target) * Math.exp(-14 * dt);
  return Math.abs(next - target) < .001 ? target : next;
}
