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
import { detectRoomCapability } from "./room-capability";
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
      viewportAtStart: readonly [number, number, number];
      viewAtStart: RoomRotation;
      captureTarget: Element | null;
    }
  | {
      kind: "dragging";
      pointerId: number;
      origin: readonly [number, number];
      viewportAtStart: readonly [number, number, number];
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

function roomViewportSnapshot(): readonly [number, number, number] {
  return [
    window.innerWidth,
    window.innerHeight,
    window.visualViewport?.scale ?? 1,
  ];
}

function roomViewportMatches(
  snapshot: readonly [number, number, number],
): boolean {
  // A pointer-up can arrive before React commits the capability change caused
  // by a resize. Compare the live viewport as well as listening for resize so
  // that a gesture can never activate an object across two room projections.
  const current = roomViewportSnapshot();
  return current.every((value, index) => value === snapshot[index]);
}

function roomPresentationStillEligible(presentation: "desktop" | "pocket") {
  const capability = detectRoomCapability();
  if (!capability.eligible) return false;
  return presentation === "pocket"
    ? capability.tier === "pocket"
    : capability.tier === "desktop-fisheye" ||
        capability.tier === "desktop-perspective";
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
  const selectionFrame = useRef<number | null>(null);
  const selectionTimer = useRef<number | null>(null);
  const hoverRay = useRef(new Ray());

  const cancelHoverFrame = useCallback(() => {
    if (hoverFrame.current === null) return;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = null;
  }, []);

  const cancelPendingSelection = useCallback(() => {
    if (selectionFrame.current !== null) {
      cancelAnimationFrame(selectionFrame.current);
      selectionFrame.current = null;
    }
    if (selectionTimer.current !== null) {
      window.clearTimeout(selectionTimer.current);
      selectionTimer.current = null;
    }
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
      cancelPendingSelection();
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
      cancelPendingSelection,
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
      cancelPendingSelection();
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
    [cancelHoverFrame, cancelPendingSelection, onInteractionActiveChange],
  );

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    cancelPendingSelection();
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
      viewportAtStart: roomViewportSnapshot(),
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
      !isRoomInteractivePointer(event.nativeEvent.pointerType, allowTouch) ||
      !roomViewportMatches(current.viewportAtStart)
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
        viewportAtStart: current.viewportAtStart,
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
      !isRoomInteractivePointer(event.nativeEvent.pointerType, allowTouch) ||
      !roomViewportMatches(current.viewportAtStart)
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
    let selectedObject: RoomObjectId | null = null;
    let selectionViewport: readonly [number, number, number] | null = null;
    if (current.kind === "pending") {
      const upObject = resolveObjectFromRay(event.ray, hitTargets, occluders);
      if (current.downObject && current.downObject === upObject) {
        selectedObject = current.downObject;
        selectionViewport = current.viewportAtStart;
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

    if (selectedObject && selectionViewport) {
      // Resizing a touch viewport can synthesize a pointer-up immediately
      // before the browser dispatches its resize event. Defer activation so
      // environment cancellation wins, then re-check the live projection
      // before navigating.
      const activate = () => {
        selectionFrame.current = null;
        selectionTimer.current = null;
        if (
          document.visibilityState !== "visible" ||
          !roomViewportMatches(selectionViewport) ||
          !roomPresentationStillEligible(presentation)
        ) {
          return;
        }
        onSelect(selectedObject);
      };
      if (allowTouch) {
        // A short confirmation window lets mobile browsers finish synthetic
        // pointer cancellation caused by resize/orientation changes before a
        // tap can navigate. It remains well below the room acknowledgement
        // animation and is imperceptible during ordinary selection.
        selectionTimer.current = window.setTimeout(activate, 64);
      } else {
        selectionFrame.current = requestAnimationFrame(activate);
      }
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
