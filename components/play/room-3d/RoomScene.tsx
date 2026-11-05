import { useThree } from "@react-three/fiber";
import { type Mesh } from "three";
import { useCallback, useRef, useState } from "react";

import {
  ROOM_OBJECT_IDS,
  type RoomObjectId,
} from "../room-platform/room-types";
import {
  RoomApproachRig,
  type RoomApproachRigHandle,
} from "./RoomApproachRig";
import { RoomInteractionController } from "./RoomInteractionController";
import { DioramaObjects } from "./DioramaObjects";
import type { RoomRotation } from "./room-math";
import type { RoomApproachPoseId } from "./room-approach";
import { ROOM_PALETTE } from "./room-palette";

export type RoomSceneProps = {
  approachPoseId: RoomApproachPoseId | null;
  focusedId?: RoomObjectId | null;
  onHoverChange?: (id: RoomObjectId | null) => void;
  onInteractionActiveChange?: (active: boolean) => void;
  onSettled?: () => void;
  onAssetsLoaded?: () => void;
  objectIds?: readonly RoomObjectId[];
  onRotationChange: (rotation: RoomRotation) => void;
  onSelect: (id: RoomObjectId) => void;
  presentation?: "desktop" | "pocket";
  rotation: RoomRotation;
  selectedId: RoomObjectId | null;
};

export function RoomScene({
  approachPoseId,
  focusedId = null,
  onHoverChange,
  onInteractionActiveChange,
  onSettled,
  onAssetsLoaded,
  objectIds = ROOM_OBJECT_IDS,
  onRotationChange,
  onSelect,
  presentation = "desktop",
  rotation,
  selectedId,
}: RoomSceneProps) {
  const { invalidate } = useThree();
  const motionRig = useRef<RoomApproachRigHandle>(null);
  const hitTargets = useRef(new Map<RoomObjectId, Mesh>());
  const occluders = useRef(new Set<Mesh>());
  const [hoveredId, setHoveredId] = useState<RoomObjectId | null>(null);

  const registerHitTarget = useCallback(
    (id: RoomObjectId, mesh: Mesh | null) => {
      if (mesh) hitTargets.current.set(id, mesh);
      else hitTargets.current.delete(id);
      invalidate();
    },
    [invalidate],
  );

  const registerOccluder = useCallback(
    (mesh: Mesh, active: boolean) => {
      if (active) occluders.current.add(mesh);
      else occluders.current.delete(mesh);
      invalidate();
    },
    [invalidate],
  );

  const setHovered = useCallback(
    (id: RoomObjectId | null) => {
      setHoveredId((current) => (current === id ? current : id));
      onHoverChange?.(id);
      invalidate();
    },
    [invalidate, onHoverChange],
  );

  const previewRotation = useCallback((nextRotation: RoomRotation) => {
    motionRig.current?.previewRotation(nextRotation);
  }, []);

  return (
    <>
      <color attach="background" args={[ROOM_PALETTE.backdrop]} />

      <RoomApproachRig
        approachPoseId={approachPoseId}
        onSettled={onSettled}
        ref={motionRig}
        rotation={rotation}
      >
        <group
          position={presentation === "pocket" ? [0, -0.8, 0] : [0, -0.55, 0]}
          scale={presentation === "pocket" ? 0.92 : 1}
        >
          <DioramaObjects objectIds={objectIds} focusedId={focusedId} hoveredId={hoveredId}
            selectedId={selectedId} registerHitTarget={registerHitTarget} registerOccluder={registerOccluder} onLoaded={onAssetsLoaded} />
          <RoomInteractionController
            disabled={selectedId !== null}
            hitTargets={hitTargets}
            occluders={occluders}
            onHoverChange={setHovered}
            onInteractionActiveChange={onInteractionActiveChange}
            onRotationCommit={onRotationChange}
            onRotationPreview={previewRotation}
            onSelect={onSelect}
            presentation={presentation}
            rotation={rotation}
          />
        </group>
      </RoomApproachRig>
    </>
  );
}
