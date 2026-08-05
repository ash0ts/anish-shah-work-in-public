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

import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import type { RoomObjectId } from "../room-platform/room-types";
import { ROOM_PALETTE } from "./room-palette";
import { RoomScene } from "./RoomScene";
import type { RoomRotation } from "./room-math";
import styles from "./RoomStage.module.css";

export type PocketRoomStageProps = {
  className?: string;
  focusedId?: RoomObjectId | null;
  onContextLoss: () => void;
  onHoverChange?: (id: RoomObjectId | null) => void;
  onPerformanceMiss?: () => void;
  onReady?: () => void;
  objectIds?: readonly RoomObjectId[];
  onRotationChange: (rotation: RoomRotation) => void;
  onSelect: (id: RoomObjectId) => void;
  rotation: RoomRotation;
  selectedId: RoomObjectId | null;
};

class PocketStageBoundary extends Component<
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

function ContextAndFrameMonitor({
  interactionActive,
  interactionEpoch,
  onContextLoss,
  onPerformanceMiss,
  onStable,
  performanceArmedAt,
}: {
  interactionActive: { current: boolean };
  interactionEpoch: { current: number };
  onContextLoss: () => void;
  onPerformanceMiss: () => void;
  onStable: () => void;
  performanceArmedAt: { current: number };
}) {
  const { gl, invalidate } = useThree();
  const frames = useRef(0);
  const consecutiveMisses = useRef(0);
  const observedInteractionEpoch = useRef(0);
  const stableSent = useRef(false);
  const performanceTripped = useRef(false);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLoss = (event: Event) => {
      event.preventDefault();
      onContextLoss();
    };
    canvas.addEventListener("webglcontextlost", handleContextLoss, { once: true });
    invalidate();
    return () => canvas.removeEventListener("webglcontextlost", handleContextLoss);
  }, [gl, invalidate, onContextLoss]);

  useFrame((_, rawDelta) => {
    if (document.visibilityState !== "visible" || performanceTripped.current) {
      return;
    }

    frames.current += 1;
    const duration = rawDelta * 1_000;
    if (!interactionActive.current) {
      consecutiveMisses.current = 0;
    } else if (observedInteractionEpoch.current !== interactionEpoch.current) {
      // A demand-rendered scene can report the whole idle interval as the
      // first delta after a gesture begins. Ignore that one inherited sample,
      // then measure every rendered frame in this interaction.
      observedInteractionEpoch.current = interactionEpoch.current;
      consecutiveMisses.current = 0;
    } else if (performance.now() < performanceArmedAt.current) {
      consecutiveMisses.current = 0;
    } else if (frames.current > 4) {
      consecutiveMisses.current =
        duration > 33 ? consecutiveMisses.current + 1 : 0;
    }

    if (frames.current < 2) invalidate();
    else if (!stableSent.current) {
      stableSent.current = true;
      queueMicrotask(onStable);
    }

    if (consecutiveMisses.current >= 3) {
      performanceTripped.current = true;
      queueMicrotask(onPerformanceMiss);
    }
  });

  return null;
}

export function PocketRoomStage({
  className,
  focusedId = null,
  onContextLoss,
  onHoverChange,
  onPerformanceMiss = onContextLoss,
  onReady,
  objectIds,
  onRotationChange,
  onSelect,
  rotation,
  selectedId,
}: PocketRoomStageProps) {
  const [failed, setFailed] = useState(false);
  const [hoveredId, setHoveredId] = useState<RoomObjectId | null>(null);
  const frameStable = useRef(false);
  const sceneSettled = useRef(false);
  const authoredEntryElapsed = useRef(false);
  const interactionActive = useRef(false);
  const interactionEpoch = useRef(0);
  const readySent = useRef(false);
  const performanceArmedAt = useRef(Number.POSITIVE_INFINITY);
  const approachPoseId = selectedId
    ? ROOM_OBJECT_BY_ID[selectedId].approachPoseId
    : null;

  const fail = useCallback(() => {
    setFailed(true);
    onContextLoss();
  }, [onContextLoss]);

  const reportReady = useCallback(() => {
    if (
      readySent.current ||
      !frameStable.current ||
      !sceneSettled.current ||
      !authoredEntryElapsed.current
    ) {
      return;
    }
    readySent.current = true;
    // Startup compilation and the poster-to-room handoff are not evidence of
    // sustained interaction cost. Arm only after both the frame and authored
    // scene motion are stable, with time for the visitor to begin manipulating.
    performanceArmedAt.current = performance.now() + 1_000;
    onReady?.();
  }, [onReady]);

  const handleStable = useCallback(() => {
    frameStable.current = true;
    reportReady();
  }, [reportReady]);

  const handleSettled = useCallback(() => {
    sceneSettled.current = true;
    reportReady();
  }, [reportReady]);

  useEffect(() => {
    // RoomApproachRig normally reports its own settled transform. Demand-mode
    // rendering must not leave the poster up forever if a platform drops one
    // of those final invalidations, though. The entry has a minimum authored
    // beat and a bounded fallback that both sit inside the 650ms shell handoff.
    const minimumBeat = window.setTimeout(() => {
      authoredEntryElapsed.current = true;
      reportReady();
    }, 450);
    const settleFallback = window.setTimeout(() => {
      sceneSettled.current = true;
      reportReady();
    }, 520);

    return () => {
      window.clearTimeout(minimumBeat);
      window.clearTimeout(settleFallback);
    };
  }, [reportReady]);

  const handleHover = useCallback(
    (id: RoomObjectId | null) => {
      setHoveredId(id);
      onHoverChange?.(id);
    },
    [onHoverChange],
  );

  const handleInteractionActiveChange = useCallback((active: boolean) => {
    interactionActive.current = active;
    if (active) interactionEpoch.current += 1;
  }, []);

  if (failed) return null;

  return (
    <PocketStageBoundary onFailure={fail}>
      <div
        aria-hidden="true"
        className={[styles.stage, styles.pocketStage, hoveredId ? styles.hasHover : "", className]
          .filter(Boolean)
          .join(" ")}
        data-projection="pocket-perspective"
        data-room-hovered-object={hoveredId ?? undefined}
        data-room-pocket-stage
        data-room-poster-stage
      >
        <Canvas
          aria-hidden="true"
          camera={{
            far: 60,
            fov: 44,
            near: 0.1,
            position: [8.2, 7.1, 10.4],
          }}
          dpr={[1, 1.15]}
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
            camera.lookAt(0, 1.05, -0.4);
            camera.updateMatrixWorld();
            gl.setClearColor(ROOM_PALETTE.backdrop, 1);
          }}
          role="presentation"
          tabIndex={-1}
        >
          <ContextAndFrameMonitor
            interactionActive={interactionActive}
            interactionEpoch={interactionEpoch}
            onContextLoss={fail}
            onPerformanceMiss={onPerformanceMiss}
            onStable={handleStable}
            performanceArmedAt={performanceArmedAt}
          />
          <RoomScene
            approachPoseId={approachPoseId}
            focusedId={focusedId}
            onHoverChange={handleHover}
            onInteractionActiveChange={handleInteractionActiveChange}
            onRotationChange={onRotationChange}
            objectIds={objectIds}
            onSelect={onSelect}
            onSettled={handleSettled}
            presentation="pocket"
            rotation={rotation}
            selectedId={selectedId}
          />
        </Canvas>
      </div>
    </PocketStageBoundary>
  );
}
