import { MathUtils } from "three";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ROOM_APPROACH_POSES,
  ROOM_OVERVIEW_TRANSFORM,
  type RoomApproachPoseId,
  type RoomApproachTransform,
} from "./room-approach";

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3;
}

function interpolateTransform(
  from: RoomApproachTransform,
  to: RoomApproachTransform,
  progress: number,
): RoomApproachTransform {
  return {
    position: [
      MathUtils.lerp(from.position[0], to.position[0], progress),
      MathUtils.lerp(from.position[1], to.position[1], progress),
      MathUtils.lerp(from.position[2], to.position[2], progress),
    ],
    scale: MathUtils.lerp(from.scale, to.scale, progress),
    yawDeg: MathUtils.lerp(from.yawDeg, to.yawDeg, progress),
  };
}

export function RoomApproachRig({
  approachPoseId,
  children,
}: {
  approachPoseId: RoomApproachPoseId | null;
  children: ReactNode;
}) {
  const [transform, setTransform] = useState<RoomApproachTransform>(
    ROOM_OVERVIEW_TRANSFORM,
  );
  const current = useRef<RoomApproachTransform>(ROOM_OVERVIEW_TRANSFORM);

  useEffect(() => {
    const from = current.current;
    const to = approachPoseId
      ? ROOM_APPROACH_POSES[approachPoseId]
      : ROOM_OVERVIEW_TRANSFORM;
    const duration = approachPoseId ? 420 : 340;
    const startedAt = performance.now();
    let frame = 0;

    const update = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const next = interpolateTransform(from, to, easeOutCubic(progress));
      current.current = next;
      setTransform(next);
      if (progress < 1) frame = requestAnimationFrame(update);
    };

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [approachPoseId]);

  return (
    <group
      position={transform.position}
      rotation={[0, MathUtils.degToRad(transform.yawDeg), 0]}
      scale={transform.scale}
    >
      {children}
    </group>
  );
}
