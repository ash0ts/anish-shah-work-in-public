import { useThree } from "@react-three/fiber";
import { type Mesh, MathUtils } from "three";
import { useCallback, useRef, useState } from "react";

import type { RoomObjectId } from "../room-platform/room-types";
import { RoomApproachRig } from "./RoomApproachRig";
import { RoomInteractionController } from "./RoomInteractionController";
import {
  BeigeComputer,
  CardioTelevision,
  PocketPlayer,
  ReadingShelf,
  RecordCrate,
  RoomShell,
  WatchTelevision,
} from "./RoomProceduralObjects";
import type { RoomRotation } from "./room-math";
import type { RoomApproachPoseId } from "./room-approach";
import { ROOM_PALETTE } from "./room-palette";

export type RoomSceneProps = {
  approachPoseId: RoomApproachPoseId | null;
  focusedId?: RoomObjectId | null;
  onHoverChange?: (id: RoomObjectId | null) => void;
  onRotationChange: (rotation: RoomRotation) => void;
  onSelect: (id: RoomObjectId) => void;
  rotation: RoomRotation;
  selectedId: RoomObjectId | null;
};

export function RoomScene({
  approachPoseId,
  focusedId = null,
  onHoverChange,
  onRotationChange,
  onSelect,
  rotation,
  selectedId,
}: RoomSceneProps) {
  const { invalidate } = useThree();
  const hitTargets = useRef(new Map<RoomObjectId, Mesh>());
  const [hoveredId, setHoveredId] = useState<RoomObjectId | null>(null);

  const registerHitTarget = useCallback(
    (id: RoomObjectId, mesh: Mesh | null) => {
      if (mesh) hitTargets.current.set(id, mesh);
      else hitTargets.current.delete(id);
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

  const isActive = (id: RoomObjectId) =>
    id === hoveredId || id === focusedId || id === selectedId;

  return (
    <>
      <color attach="background" args={[ROOM_PALETTE.backdrop]} />
      <hemisphereLight args={["#fff6ea", "#505769", 2.15]} />
      <directionalLight color="#fff0dc" intensity={2.4} position={[5, 8, 6]} />

      <RoomApproachRig approachPoseId={approachPoseId}>
        <group
          position={[0, -0.65, 0]}
          rotation={[
            MathUtils.degToRad(rotation.x),
            MathUtils.degToRad(rotation.y),
            0,
          ]}
        >
          <RoomShell />
          <WatchTelevision
            active={isActive("watch")}
            registerHitTarget={registerHitTarget}
          />
          <ReadingShelf
            active={isActive("read")}
            registerHitTarget={registerHitTarget}
          />
          <PocketPlayer
            active={isActive("listen")}
            registerHitTarget={registerHitTarget}
          />
          <RecordCrate
            active={isActive("collect")}
            registerHitTarget={registerHitTarget}
          />
          <BeigeComputer
            active={isActive("play")}
            registerHitTarget={registerHitTarget}
          />
          <CardioTelevision
            active={isActive("move")}
            registerHitTarget={registerHitTarget}
          />
          <RoomInteractionController
            disabled={selectedId !== null}
            hitTargets={hitTargets}
            onHoverChange={setHovered}
            onRotationChange={onRotationChange}
            onSelect={onSelect}
            rotation={rotation}
          />
        </group>
      </RoomApproachRig>
    </>
  );
}
