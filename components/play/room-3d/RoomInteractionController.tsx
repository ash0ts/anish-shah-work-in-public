import type { ThreeEvent } from "@react-three/fiber";
import { usePathname } from "next/navigation";
import { Ray, type Mesh } from "three";
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

import type { RoomObjectId } from "../room-platform/room-types";
import { isRoomObjectId } from "../room-platform/room-registry";
import { ROOM_BASIC_MATERIALS } from "./room-materials";
import { resolveRoomRayHit } from "./room-hit-resolution";
import {
  crossedRoomDragThreshold,
  rotationFromPointerDelta,
  type RoomRotation,
} from "./room-math";
import {
  isCompetingRoomPointer,
  isRoomInteractivePointer,
} from "./room-pointer-policy";

type PointerIntent =
  | { kind: "idle" }
  | {
      kind: "pending";
      pointerId: number;
      downObject: RoomObjectId | null;
      origin: readonly [number, number];
      viewAtStart: RoomRotation;
      captureTarget: HTMLCanvasElement | null;
    }
  | {
      kind: "dragging";
      pointerId: number;
      origin: readonly [number, number];
      viewAtStart: RoomRotation;
      captureTarget: HTMLCanvasElement | null;
    };

type RoomInteractionControllerProps = {
  disabled: boolean;
  hitTargets: MutableRefObject<Map<RoomObjectId, Mesh>>;
  occluders: MutableRefObject<Set<Mesh>>;
  onHoverChange: (id: RoomObjectId | null) => void;
  onRotationChange: (rotation: RoomRotation) => void;
  onSelect: (id: RoomObjectId) => void;
  rotation: RoomRotation;
};

function resolveObjectFromRay(
  ray: Ray,
  hitTargets: MutableRefObject<Map<RoomObjectId, Mesh>>,
  occluders: MutableRefObject<Set<Mesh>>,
) {
  const candidate = resolveRoomRayHit(
    ray,
    hitTargets.current.values(),
    occluders.current.values(),
  );
  return isRoomObjectId(candidate) ? candidate : null;
}

function pointerCaptureTarget(event: ThreeEvent<PointerEvent>) {
  const target = event.nativeEvent.currentTarget;
  return target instanceof HTMLCanvasElement ? target : null;
}

export function RoomInteractionController({
  disabled,
  hitTargets,
  occluders,
  onHoverChange,
  onRotationChange,
  onSelect,
  rotation,
}: RoomInteractionControllerProps) {
  const pathname = usePathname();
  const intent = useRef<PointerIntent>({ kind: "idle" });
  const previousPathname = useRef(pathname);
  const hoverFrame = useRef<number | null>(null);
  const hoverRay = useRef(new Ray());

  const cancelHoverFrame = useCallback(() => {
    if (hoverFrame.current === null) return;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = null;
  }, []);

  const queueHover = useCallback(
    (ray: Ray) => {
      hoverRay.current.copy(ray);
      if (hoverFrame.current !== null) return;

      hoverFrame.current = requestAnimationFrame(() => {
        hoverFrame.current = null;
        onHoverChange(
          resolveObjectFromRay(hoverRay.current, hitTargets, occluders),
        );
      });
    },
    [hitTargets, occluders, onHoverChange],
  );

  const cancelGesture = useCallback(
    (restoreView: boolean) => {
      const current = intent.current;
      cancelHoverFrame();
      if (
        current.kind !== "idle" &&
        current.captureTarget?.hasPointerCapture(current.pointerId)
      ) {
        current.captureTarget.releasePointerCapture(current.pointerId);
      }
      if (restoreView && current.kind === "dragging") {
        onRotationChange(current.viewAtStart);
      }
      intent.current = { kind: "idle" };
      onHoverChange(null);
    },
    [cancelHoverFrame, onHoverChange, onRotationChange],
  );

  useEffect(() => {
    if (disabled) cancelGesture(false);
  }, [cancelGesture, disabled]);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      cancelGesture(true);
    }
  }, [cancelGesture, pathname]);

  useEffect(() => {
    const cancelForEnvironmentChange = () => cancelGesture(true);
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") cancelGesture(true);
    };

    window.addEventListener("resize", cancelForEnvironmentChange, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("resize", cancelForEnvironmentChange);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [cancelGesture]);

  useEffect(
    () => () => {
      cancelHoverFrame();
      const current = intent.current;
      if (
        current.kind !== "idle" &&
        current.captureTarget?.hasPointerCapture(current.pointerId)
      ) {
        current.captureTarget.releasePointerCapture(current.pointerId);
      }
      intent.current = { kind: "idle" };
    },
    [cancelHoverFrame],
  );

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    const activePointerId =
      intent.current.kind === "idle" ? null : intent.current.pointerId;
    if (isCompetingRoomPointer(activePointerId, event.pointerId)) {
      cancelGesture(true);
      return;
    }

    if (
      disabled ||
      !isRoomInteractivePointer(event.nativeEvent.pointerType) ||
      !event.nativeEvent.isPrimary ||
      event.nativeEvent.button !== 0
    ) {
      if (intent.current.kind !== "idle") cancelGesture(true);
      return;
    }

    event.stopPropagation();
    event.nativeEvent.preventDefault();

    if (intent.current.kind !== "idle") {
      cancelGesture(true);
      return;
    }

    const origin = [event.nativeEvent.clientX, event.nativeEvent.clientY] as const;
    const captureTarget = pointerCaptureTarget(event);
    intent.current = {
      kind: "pending",
      pointerId: event.pointerId,
      downObject: resolveObjectFromRay(event.ray, hitTargets, occluders),
      origin,
      viewAtStart: rotation,
      captureTarget,
    };

    captureTarget?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (disabled) return;

    const current = intent.current;
    if (current.kind === "idle") {
      if (isRoomInteractivePointer(event.nativeEvent.pointerType)) {
        queueHover(event.ray);
      }
      return;
    }

    if (
      current.pointerId !== event.pointerId ||
      !isRoomInteractivePointer(event.nativeEvent.pointerType)
    ) {
      cancelGesture(true);
      return;
    }

    event.stopPropagation();
    const point = [event.nativeEvent.clientX, event.nativeEvent.clientY] as const;

    if (
      current.kind === "pending" &&
      crossedRoomDragThreshold(current.origin, point)
    ) {
      intent.current = {
        kind: "dragging",
        pointerId: current.pointerId,
        origin: current.origin,
        viewAtStart: current.viewAtStart,
        captureTarget: current.captureTarget,
      };
      onHoverChange(null);
    }

    const updated = intent.current;
    if (updated.kind !== "dragging") return;

    onRotationChange(
      rotationFromPointerDelta(
        updated.viewAtStart,
        point[0] - updated.origin[0],
        point[1] - updated.origin[1],
      ),
    );
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    const current = intent.current;
    if (current.kind === "idle") return;
    if (
      current.pointerId !== event.pointerId ||
      !isRoomInteractivePointer(event.nativeEvent.pointerType)
    ) {
      cancelGesture(true);
      return;
    }

    event.stopPropagation();
    const captureTarget = current.captureTarget ?? pointerCaptureTarget(event);
    if (captureTarget?.hasPointerCapture(event.pointerId)) {
      captureTarget.releasePointerCapture(event.pointerId);
    }

    if (current.kind === "pending") {
      const upObject = resolveObjectFromRay(event.ray, hitTargets, occluders);
      if (current.downObject && current.downObject === upObject) {
        onSelect(current.downObject);
      }
    }

    intent.current = { kind: "idle" };
    if (isRoomInteractivePointer(event.nativeEvent.pointerType)) {
      queueHover(event.ray);
    }
  };

  const handlePointerLeave = () => {
    if (intent.current.kind === "idle") {
      cancelHoverFrame();
      onHoverChange(null);
    }
  };

  return (
    <mesh
      onLostPointerCapture={() => cancelGesture(true)}
      onPointerCancel={() => cancelGesture(true)}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      material={ROOM_BASIC_MATERIALS.invisible}
      scale={38}
      visible={false}
    >
      <sphereGeometry args={[1, 10, 8]} />
    </mesh>
  );
}
