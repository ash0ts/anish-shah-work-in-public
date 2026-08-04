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
  POCKET_ROOM_DRAG_THRESHOLD_PX,
  rotationFromPointerDelta,
  rotationFromPocketPointerDelta,
  snapPocketRoomRotation,
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
      captureTarget: Element | null;
    }
  | {
      kind: "dragging";
      pointerId: number;
      origin: readonly [number, number];
      viewAtStart: RoomRotation;
      latestView: RoomRotation;
      captureTarget: Element | null;
    };

type RoomInteractionControllerProps = {
  disabled: boolean;
  hitTargets: MutableRefObject<Map<RoomObjectId, Mesh>>;
  occluders: MutableRefObject<Set<Mesh>>;
  onHoverChange: (id: RoomObjectId | null) => void;
  onInteractionActiveChange?: (active: boolean) => void;
  onRotationCommit: (rotation: RoomRotation) => void;
  onRotationPreview: (rotation: RoomRotation) => void;
  onSelect: (id: RoomObjectId) => void;
  presentation?: "desktop" | "pocket";
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
  return target instanceof Element ? target : null;
}

export function RoomInteractionController({
  disabled,
  hitTargets,
  occluders,
  onHoverChange,
  onInteractionActiveChange,
  onRotationCommit,
  onRotationPreview,
  onSelect,
  presentation = "desktop",
  rotation,
}: RoomInteractionControllerProps) {
  const allowTouch = presentation === "pocket";
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
        onRotationPreview(current.viewAtStart);
      }
      intent.current = { kind: "idle" };
      onInteractionActiveChange?.(false);
      onHoverChange(null);
    },
    [
      cancelHoverFrame,
      onHoverChange,
      onInteractionActiveChange,
      onRotationPreview,
    ],
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
      onInteractionActiveChange?.(false);
    },
    [cancelHoverFrame, onInteractionActiveChange],
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
      !isRoomInteractivePointer(event.nativeEvent.pointerType, allowTouch) ||
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
      !isRoomInteractivePointer(event.nativeEvent.pointerType, allowTouch)
    ) {
      cancelGesture(true);
      return;
    }

    event.stopPropagation();
    const point = [event.nativeEvent.clientX, event.nativeEvent.clientY] as const;

    if (
      current.kind === "pending" &&
      crossedRoomDragThreshold(
        current.origin,
        point,
        allowTouch ? POCKET_ROOM_DRAG_THRESHOLD_PX : undefined,
      )
    ) {
      intent.current = {
        kind: "dragging",
        pointerId: current.pointerId,
        origin: current.origin,
        viewAtStart: current.viewAtStart,
        latestView: current.viewAtStart,
        captureTarget: current.captureTarget,
      };
      onInteractionActiveChange?.(true);
      onHoverChange(null);
    }

    const updated = intent.current;
    if (updated.kind !== "dragging") return;

    const nextView = allowTouch
      ? rotationFromPocketPointerDelta(
          updated.viewAtStart,
          point[0] - updated.origin[0],
        )
      : rotationFromPointerDelta(
          updated.viewAtStart,
          point[0] - updated.origin[0],
          point[1] - updated.origin[1],
        );
    intent.current = { ...updated, latestView: nextView };
    onRotationPreview(nextView);
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    const current = intent.current;
    if (current.kind === "idle") return;
    if (
      current.pointerId !== event.pointerId ||
      !isRoomInteractivePointer(event.nativeEvent.pointerType, allowTouch)
    ) {
      cancelGesture(true);
      return;
    }

    event.stopPropagation();
    const captureTarget = current.captureTarget ?? pointerCaptureTarget(event);
    if (captureTarget?.hasPointerCapture(event.pointerId)) {
      captureTarget.releasePointerCapture(event.pointerId);
    }

    const resumeHoverFromRelease = current.kind === "pending";
    if (current.kind === "pending") {
      const upObject = resolveObjectFromRay(event.ray, hitTargets, occluders);
      if (current.downObject && current.downObject === upObject) {
        onSelect(current.downObject);
      }
    } else {
      onRotationCommit(
        allowTouch
          ? snapPocketRoomRotation(current.latestView)
          : current.latestView,
      );
    }

    intent.current = { kind: "idle" };
    onInteractionActiveChange?.(false);
    if (
      resumeHoverFromRelease &&
      isRoomInteractivePointer(event.nativeEvent.pointerType, allowTouch) &&
      event.nativeEvent.pointerType !== "touch"
    ) {
      queueHover(event.ray);
    } else {
      onHoverChange(null);
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
