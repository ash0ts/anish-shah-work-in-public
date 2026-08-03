import { useFrame, useThree } from "@react-three/fiber";
import { MathUtils, type Group } from "three";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import type { RoomRotation } from "./room-math";
import {
  ROOM_APPROACH_POSES,
  ROOM_OVERVIEW_TRANSFORM,
  type RoomApproachPoseId,
  type RoomApproachTransform,
} from "./room-approach";

type AnimatedRoomTransform = {
  position: [number, number, number];
  rotationXDeg: number;
  rotationYDeg: number;
  scale: number;
};

const ROOM_ENTRY_TRANSFORM: AnimatedRoomTransform = {
  position: [0, 1.35, -0.48],
  rotationXDeg: -2.5,
  rotationYDeg: -5,
  scale: 0.88,
};

function targetTransform(
  approach: RoomApproachTransform,
  rotation: RoomRotation,
): AnimatedRoomTransform {
  return {
    position: [...approach.position],
    rotationXDeg: rotation.x,
    rotationYDeg: approach.yawDeg + rotation.y,
    scale: approach.scale,
  };
}

function near(left: number, right: number, epsilon = 0.001) {
  return Math.abs(left - right) <= epsilon;
}

export type RoomApproachRigHandle = {
  previewRotation(rotation: RoomRotation): void;
};

type RoomApproachRigProps = {
  approachPoseId: RoomApproachPoseId | null;
  children: ReactNode;
  onSettled?: () => void;
  rotation: RoomRotation;
};

export const RoomApproachRig = forwardRef<
  RoomApproachRigHandle,
  RoomApproachRigProps
>(function RoomApproachRig(
  { approachPoseId, children, onSettled, rotation },
  forwardedRef,
) {
  const group = useRef<Group>(null);
  const current = useRef<AnimatedRoomTransform>({
    ...ROOM_ENTRY_TRANSFORM,
    position: [...ROOM_ENTRY_TRANSFORM.position],
  });
  const target = useRef(
    targetTransform(ROOM_OVERVIEW_TRANSFORM, rotation),
  );
  const moving = useRef(true);
  const approaching = useRef(false);
  const { invalidate } = useThree();

  const moveToRotation = useCallback(
    (nextRotation: RoomRotation) => {
      const approach = approachPoseId
        ? ROOM_APPROACH_POSES[approachPoseId]
        : ROOM_OVERVIEW_TRANSFORM;
      approaching.current = approachPoseId !== null;
      target.current = targetTransform(approach, nextRotation);
      moving.current = true;
      invalidate();
    },
    [approachPoseId, invalidate],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({ previewRotation: moveToRotation }),
    [moveToRotation],
  );

  useEffect(() => moveToRotation(rotation), [moveToRotation, rotation]);

  useFrame((_, rawDelta) => {
    const object = group.current;
    if (!object || !moving.current) return;
    const delta = Math.min(0.05, rawDelta);
    const destination = target.current;
    const value = current.current;
    const translationDamping = approaching.current ? 12 : 8;

    value.position = [
      MathUtils.damp(
        value.position[0],
        destination.position[0],
        translationDamping,
        delta,
      ),
      MathUtils.damp(
        value.position[1],
        destination.position[1],
        translationDamping,
        delta,
      ),
      MathUtils.damp(
        value.position[2],
        destination.position[2],
        translationDamping,
        delta,
      ),
    ];
    value.scale = MathUtils.damp(
      value.scale,
      destination.scale,
      translationDamping,
      delta,
    );
    value.rotationXDeg = MathUtils.damp(
      value.rotationXDeg,
      destination.rotationXDeg,
      20,
      delta,
    );
    value.rotationYDeg = MathUtils.damp(
      value.rotationYDeg,
      destination.rotationYDeg,
      20,
      delta,
    );

    object.position.set(...value.position);
    object.rotation.set(
      MathUtils.degToRad(value.rotationXDeg),
      MathUtils.degToRad(value.rotationYDeg),
      0,
    );
    object.scale.setScalar(value.scale);

    const settled =
      value.position.every((component, index) =>
        near(component, destination.position[index]),
      ) &&
      near(value.scale, destination.scale, 0.0005) &&
      near(value.rotationXDeg, destination.rotationXDeg, 0.03) &&
      near(value.rotationYDeg, destination.rotationYDeg, 0.03);
    if (settled) {
      current.current = {
        ...destination,
        position: [...destination.position],
      };
      object.position.set(...destination.position);
      object.rotation.set(
        MathUtils.degToRad(destination.rotationXDeg),
        MathUtils.degToRad(destination.rotationYDeg),
        0,
      );
      object.scale.setScalar(destination.scale);
      moving.current = false;
      if (onSettled) queueMicrotask(onSettled);
      return;
    }
    invalidate();
  }, -3);

  return (
    <group
      position={ROOM_ENTRY_TRANSFORM.position}
      ref={group}
      rotation={[
        MathUtils.degToRad(ROOM_ENTRY_TRANSFORM.rotationXDeg),
        MathUtils.degToRad(ROOM_ENTRY_TRANSFORM.rotationYDeg),
        0,
      ]}
      scale={ROOM_ENTRY_TRANSFORM.scale}
    >
      {children}
    </group>
  );
});
