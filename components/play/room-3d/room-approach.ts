import type { RoomObjectDefinition } from "../room-platform/room-types";

export type RoomApproachPoseId = RoomObjectDefinition["approachPoseId"];

export type RoomApproachTransform = Readonly<{
  position: readonly [number, number, number];
  scale: number;
  yawDeg: number;
}>;

export const ROOM_OVERVIEW_TRANSFORM: RoomApproachTransform = Object.freeze({
  position: [0, 0, 0] as const,
  scale: 1,
  yawDeg: 0,
});

export const ROOM_APPROACH_POSES: Record<
  RoomApproachPoseId,
  RoomApproachTransform
> = Object.freeze({
  "watch-approach": { position: [2.15, -0.08, 0.68], scale: 1.2, yawDeg: 4 },
  "read-approach": { position: [0.42, -0.24, 0.72], scale: 1.22, yawDeg: 1 },
  "listen-approach": { position: [0.48, 0.18, 1.05], scale: 1.34, yawDeg: 0 },
  "collect-approach": { position: [1.55, 0.18, 0.92], scale: 1.27, yawDeg: 4 },
  "play-approach": { position: [-1.18, -0.08, 0.82], scale: 1.2, yawDeg: -3 },
  "move-approach": { position: [-1.85, -0.12, 0.68], scale: 1.18, yawDeg: -5 },
  "travel-approach": { position: [-1.08, -0.18, 1.08], scale: 1.34, yawDeg: -2 },
});
