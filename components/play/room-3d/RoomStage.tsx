"use client";

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
import type { RoomRotation } from "./room-math";
import styles from "./RoomStage.module.css";

export type RoomProjection = "wide-perspective";

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
  const readySent = useRef(false);
  const approachPoseId = selectedId
    ? ROOM_OBJECT_BY_ID[selectedId].approachPoseId
    : null;

  const fail = useCallback(() => {
    setFailed(true);
    onContextLoss();
  }, [onContextLoss]);

  const handleStableFrame = useCallback(() => {
    if (!readySent.current) {
      readySent.current = true;
      onProjectionChange?.("wide-perspective");
      onReady?.();
    }
  }, [onProjectionChange, onReady]);

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
      onRotationChange={onRotationChange}
      onSelect={onSelect}
      rotation={rotation}
      selectedId={selectedId}
    />
  );

  return (
    <RoomStageBoundary onFailure={fail}>
      <div
        aria-hidden="true"
        className={[styles.stage, hoveredId ? styles.hasHover : "", className]
          .filter(Boolean)
          .join(" ")}
        data-room-poster-stage
        data-projection="wide-perspective"
      >
        <Canvas
          aria-hidden="true"
          camera={{
            far: 50,
            fov: 38,
            near: 0.1,
            position: [6.05, 4.7, 7.05],
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
            camera.lookAt(0, 1.25, -0.15);
            camera.updateMatrixWorld();
            gl.setClearColor(ROOM_PALETTE.backdrop, 1);
          }}
          role="presentation"
          tabIndex={-1}
        >
          <ContextLossMonitor onContextLoss={fail} />
          {roomScene}
          <StableFrameSignal onStable={handleStableFrame} />
        </Canvas>
      </div>
    </RoomStageBoundary>
  );
}
