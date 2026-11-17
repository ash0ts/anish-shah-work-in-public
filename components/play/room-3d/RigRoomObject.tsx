import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { BufferGeometry, Float32BufferAttribute, type Group, type Mesh } from "three";
import type { RoomObjectId } from "../room-platform/room-types";
import { buildRigRoomMesh } from "./rig-room-model";
import { ROOM_SCENE_OBJECTS } from "./room-scene-layout";
import { roomPropResponse, settleRoomPose } from "./room-prop-response";

export function RigRoomObject({ active, selected, registerHit }: {
  active: boolean; selected: boolean; registerHit: (id: RoomObjectId, mesh: Mesh | null) => void;
}) {
  const { invalidate } = useThree();
  const root = useRef<Group>(null), response = useRef(0);
  const layout = ROOM_SCENE_OBJECTS.rig.layout;
  const geometry = useMemo(() => {
    const mesh = buildRigRoomMesh();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(mesh.colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }, []);
  const connect = useCallback((mesh: Mesh | null) => {
    if(mesh) mesh.userData.roomObjectId = "rig";
    registerHit("rig", mesh);
  }, [registerHit]);
  useEffect(() => { invalidate(); }, [active, selected, invalidate]);
  useFrame((_,delta) => {
    const target = active || selected ? 1 : 0;
    response.current = settleRoomPose(response.current, target, delta);
    if(root.current) root.current.scale.setScalar(layout.scale * roomPropResponse("rig", response.current).scale);
    if(response.current !== target) invalidate();
  });
  return <group name="OBJ__rig" position={[...layout.position]} rotation={[0,layout.rotation,0]}>
    <group ref={root} name="motion__rig">
      <mesh name="body__rig" geometry={geometry}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>
    </group>
    <mesh ref={connect} position={[...layout.hit]} visible={false}>
      <boxGeometry args={[...layout.size]} /><meshBasicMaterial colorWrite={false} depthWrite={false} />
    </mesh>
  </group>;
}
