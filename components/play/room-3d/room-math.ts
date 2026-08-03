export type RoomRotation = Readonly<{
  /** Polar offset in degrees. */
  x: number;
  /** Azimuth offset in degrees. */
  y: number;
}>;

export const ROOM_ROTATION_LIMITS = Object.freeze({
  polar: [-7, 7] as const,
  azimuth: [-12, 12] as const,
  keyboardStep: 4,
});

export const ROOM_DRAG_THRESHOLD_PX = 8;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampRoomRotation(rotation: RoomRotation): RoomRotation {
  return {
    x: clamp(
      rotation.x,
      ROOM_ROTATION_LIMITS.polar[0],
      ROOM_ROTATION_LIMITS.polar[1],
    ),
    y: clamp(
      rotation.y,
      ROOM_ROTATION_LIMITS.azimuth[0],
      ROOM_ROTATION_LIMITS.azimuth[1],
    ),
  };
}

export function pointerDistance(
  origin: readonly [number, number],
  current: readonly [number, number],
) {
  return Math.hypot(current[0] - origin[0], current[1] - origin[1]);
}

export function crossedRoomDragThreshold(
  origin: readonly [number, number],
  current: readonly [number, number],
) {
  return pointerDistance(origin, current) > ROOM_DRAG_THRESHOLD_PX;
}

export function rotationFromPointerDelta(
  start: RoomRotation,
  deltaX: number,
  deltaY: number,
): RoomRotation {
  return clampRoomRotation({
    x: start.x + deltaY * 0.055,
    y: start.y + deltaX * 0.085,
  });
}
