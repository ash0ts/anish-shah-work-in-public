"use client";

import { Fisheye } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { RoomObjectId } from "../room-platform/room-types";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import { ROOM_PALETTE } from "./room-palette";
import { RoomScene } from "./RoomScene";
import {
  createFisheyeHealthState,
  recordCompletedFisheyeFrame,
} from "./room-fisheye-health";
import type { RoomRotation } from "./room-math";
import styles from "./RoomStage.module.css";

export type RoomProjection = "fisheye" | "wide-perspective";

const FISHEYE_SESSION_DOWNGRADE_KEY = "anish-room-fisheye-downgrade-v2";

export type RoomStageProps = {
  className?: string;
  focusedId?: RoomObjectId | null;
  onContextLoss: () => void;
  onHoverChange?: (id: RoomObjectId | null) => void;
  onProjectionChange?: (projection: RoomProjection) => void;
  onReady?: () => void;
  onRotationChange: (rotation: RoomRotation) => void;
  onSelect: (id: RoomObjectId) => void;
  rotation: RoomRotation;
  selectedId: RoomObjectId | null;
};

class RoomStageBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

class RoomProjectionBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function initialProjection(): RoomProjection {
  if (typeof window === "undefined") return "fisheye";
  try {
    return window.sessionStorage.getItem(FISHEYE_SESSION_DOWNGRADE_KEY) === "1"
      ? "wide-perspective"
      : "fisheye";
  } catch {
    return "fisheye";
  }
}

function ContextLossMonitor({ onContextLoss }: { onContextLoss: () => void }) {
  const { gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLoss = (event: Event) => {
      event.preventDefault();
      onContextLoss();
    };

    canvas.addEventListener("webglcontextlost", handleContextLoss, { once: true });
    return () => canvas.removeEventListener("webglcontextlost", handleContextLoss);
  }, [gl, onContextLoss]);

  return null;
}

function StableFrameSignal({ onStable }: { onStable: () => void }) {
  const sent = useRef(false);
  const frameCount = useRef(0);
  const { invalidate } = useThree();

  useEffect(() => invalidate(), [invalidate]);

  useFrame(() => {
    if (sent.current) return;
    frameCount.current += 1;
    if (frameCount.current < 2) {
      invalidate();
      return;
    }
    sent.current = true;
    queueMicrotask(onStable);
  });

  return null;
}

function FisheyeFrameMonitor({
  onPerformanceMiss,
  onStable,
}: {
  onPerformanceMiss: () => void;
  onStable: () => void;
}) {
  const frameStartedAt = useRef(0);
  const completedFrameCount = useRef(0);
  const health = useRef(createFisheyeHealthState());
  const stableSent = useRef(false);
  const tripped = useRef(false);
  const { invalidate } = useThree();

  useEffect(() => invalidate(), [invalidate]);

  useFrame(() => {
    frameStartedAt.current = performance.now();
  }, -4);

  useFrame(() => {
    if (document.visibilityState !== "visible" || tripped.current) return;

    completedFrameCount.current += 1;
    const result = recordCompletedFisheyeFrame(
      health.current,
      performance.now() - frameStartedAt.current,
    );
    health.current = result.state;

    if (completedFrameCount.current === 1) {
      invalidate();
    } else if (!stableSent.current) {
      stableSent.current = true;
      queueMicrotask(onStable);
    }

    if (result.downgrade) {
      tripped.current = true;
      queueMicrotask(onPerformanceMiss);
    }
  }, 2);

  return null;
}

function ResponsiveFisheye({ children }: { children: ReactNode }) {
  const { height, width } = useThree((state) => state.size);
  const sizeKey = `${Math.round(width)}x${Math.round(height)}`;

  // Drei 10.7.7 captures its event-projection sphere on mount. Remounting
  // after a CSS-size change keeps the visible fisheye and pointer ray in sync.
  return (
    <Fisheye
      key={sizeKey}
      renderPriority={1}
      resolution={640}
      segments={32}
      zoom={0.72}
    >
      {children}
    </Fisheye>
  );
}

export function RoomStage({
  className,
  focusedId = null,
  onContextLoss,
  onHoverChange,
  onProjectionChange,
  onReady,
  onRotationChange,
  onSelect,
  rotation,
  selectedId,
}: RoomStageProps) {
  const [failed, setFailed] = useState(false);
  const [hoveredId, setHoveredId] = useState<RoomObjectId | null>(null);
  const [projection, setProjection] = useState<RoomProjection>(initialProjection);
  const readySent = useRef(false);
  const projectionStable = useRef(false);
  const sceneSettled = useRef(false);
  const initializationWatchdog = useRef<number | null>(null);
  const approachPoseId = selectedId
    ? ROOM_OBJECT_BY_ID[selectedId].approachPoseId
    : null;

  const fail = useCallback(() => {
    setFailed(true);
    onContextLoss();
  }, [onContextLoss]);

  const clearInitializationWatchdog = useCallback(() => {
    if (initializationWatchdog.current === null) return;
    window.clearTimeout(initializationWatchdog.current);
    initializationWatchdog.current = null;
  }, []);

  const reportReadyIfStable = useCallback(() => {
    if (
      readySent.current ||
      !projectionStable.current ||
      !sceneSettled.current
    ) {
      return;
    }
    readySent.current = true;
    onProjectionChange?.(projection);
    onReady?.();
  }, [onProjectionChange, onReady, projection]);

  const handleStableFrame = useCallback(() => {
    clearInitializationWatchdog();
    projectionStable.current = true;
    reportReadyIfStable();
  }, [clearInitializationWatchdog, reportReadyIfStable]);

  const handleSceneSettled = useCallback(() => {
    sceneSettled.current = true;
    reportReadyIfStable();
  }, [reportReadyIfStable]);

  const downgradeProjection = useCallback(() => {
    clearInitializationWatchdog();
    try {
      window.sessionStorage.setItem(FISHEYE_SESSION_DOWNGRADE_KEY, "1");
    } catch {
      // A blocked storage API must not prevent the perspective fallback.
    }
    setHoveredId(null);
    onHoverChange?.(null);
    readySent.current = false;
    projectionStable.current = false;
    sceneSettled.current = false;
    setProjection((current) =>
      current === "fisheye" ? "wide-perspective" : current,
    );
  }, [clearInitializationWatchdog, onHoverChange]);

  useEffect(() => {
    if (projection !== "fisheye" || readySent.current) return;
    clearInitializationWatchdog();
    initializationWatchdog.current = window.setTimeout(
      downgradeProjection,
      2_000,
    );
    return clearInitializationWatchdog;
  }, [clearInitializationWatchdog, downgradeProjection, projection]);

  const handleHoverChange = useCallback(
    (id: RoomObjectId | null) => {
      setHoveredId(id);
      onHoverChange?.(id);
    },
    [onHoverChange],
  );

  if (failed) return null;

  const roomScene = (
    <RoomScene
      approachPoseId={approachPoseId}
      focusedId={focusedId}
      onHoverChange={handleHoverChange}
      onSettled={handleSceneSettled}
      onRotationChange={onRotationChange}
      onSelect={onSelect}
      rotation={rotation}
      selectedId={selectedId}
    />
  );

  const projectedRoom =
    projection === "fisheye" ? (
      <RoomProjectionBoundary onFailure={downgradeProjection}>
        <ResponsiveFisheye>{roomScene}</ResponsiveFisheye>
      </RoomProjectionBoundary>
    ) : (
      roomScene
    );

  return (
    <RoomStageBoundary onFailure={fail}>
      <div
        aria-hidden="true"
        className={[styles.stage, hoveredId ? styles.hasHover : "", className]
          .filter(Boolean)
          .join(" ")}
        data-room-hovered-object={hoveredId ?? undefined}
        data-room-poster-stage
        data-projection={projection}
      >
        <Canvas
          aria-hidden="true"
          camera={{
            far: 50,
            fov: 46,
            near: 0.1,
            position: [4.8, 4.3, 5.5],
          }}
          dpr={[1, 1.25]}
          frameloop="demand"
          gl={{
            alpha: false,
            antialias: false,
            depth: true,
            failIfMajorPerformanceCaveat: true,
            powerPreference: "low-power",
            stencil: false,
          }}
          onCreated={({ camera, gl }) => {
            gl.domElement.setAttribute("aria-hidden", "true");
            gl.domElement.setAttribute("role", "presentation");
            gl.domElement.tabIndex = -1;
            camera.lookAt(0, 1.05, -0.42);
            camera.updateMatrixWorld();
            gl.setClearColor(ROOM_PALETTE.backdrop, 1);
          }}
          role="presentation"
          tabIndex={-1}
        >
          <ContextLossMonitor onContextLoss={fail} />
          {projectedRoom}
          {projection === "fisheye" ? (
            <FisheyeFrameMonitor
              key={projection}
              onPerformanceMiss={downgradeProjection}
              onStable={handleStableFrame}
            />
          ) : (
            <StableFrameSignal key={projection} onStable={handleStableFrame} />
          )}
        </Canvas>
      </div>
    </RoomStageBoundary>
  );
}
