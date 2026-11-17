import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { MathUtils, type Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { RoomObjectId } from "../room-platform/room-types";
import manifest from "./diorama.generated.json";
import { roomAtlasPlugin } from "./room-atlas";
import { roomFamiliarPose, roomPropResponse, settleRoomPose } from "./room-prop-response";
import { ROOM_SCENE_OBJECTS, type BakedRoomObjectId } from "./room-scene-layout";
import { RigRoomObject } from "./RigRoomObject";

type RegisterHit = (id: RoomObjectId, mesh: Mesh | null) => void;
type RegisterOccluder = (mesh: Mesh, active: boolean) => void;

function Proxy({ id, position, size, registerHit, registerOccluder }: {
  id?: RoomObjectId; position: [number, number, number]; size: [number, number, number];
  registerHit?: RegisterHit; registerOccluder?: RegisterOccluder;
}) {
  const current = useRef<Mesh | null>(null);
  const connect = useCallback((mesh: Mesh | null) => {
    if (current.current) registerOccluder?.(current.current, false);
    current.current = mesh;
    if (id) {
      if (mesh) mesh.userData.roomObjectId = id;
      registerHit?.(id, mesh);
    } else if (mesh) {
      mesh.userData.roomOccluder = true;
      registerOccluder?.(mesh, true);
    }
  }, [id, registerHit, registerOccluder]);
  return <mesh ref={connect} position={position} visible={false}>
    <boxGeometry args={size} />
    <meshBasicMaterial colorWrite={false} depthWrite={false} />
  </mesh>;
}

function DioramaProp({ source, id, active, selected, registerHit }: {
  source: Object3D; id: BakedRoomObjectId; active: boolean; selected: boolean; registerHit: RegisterHit;
}) {
  const { invalidate } = useThree();
  const object = useMemo(() => source.clone(true), [source]);
  const moving = useMemo(() => object.getObjectByName(`motion__${id}`)!, [object, id]);
  const rootRef = useRef<Object3D>(null);
  const movingRef = useRef<Object3D | null>(null);
  const base = useMemo(() => ({ position: moving.position.clone(), scale: moving.scale.clone() }), [moving]);
  const response = useRef(0);
  const layout = manifest.props[id];
  useEffect(() => { movingRef.current = moving; invalidate(); }, [moving, active, selected, invalidate]);
  useFrame((_, delta) => {
    const moving = movingRef.current;
    const root = rootRef.current;
    if (!moving || !root) return;
    const target = active || selected ? 1 : 0;
    const next = MathUtils.damp(response.current, target, 18, Math.min(delta, .05));
    response.current = Math.abs(next - target) < .001 ? target : next;
    const t = response.current;
    moving.position.copy(base.position);
    moving.rotation.set(0, 0, 0);
    moving.scale.copy(base.scale);
    const pose = roomPropResponse(id, t);
    moving.position.y += pose.offsetY;
    moving.position.z += pose.offsetZ;
    moving.rotation.y = pose.yaw;
    moving.visible = pose.visible;
    root.scale.setScalar(layout.scale * pose.scale);
    if (response.current !== target) invalidate();
  });
  return <>
    <primitive ref={rootRef} object={object} dispose={null} />
    <group position={layout.position as [number, number, number]} rotation={[0, layout.rotation, 0]} scale={layout.scale}>
      <Proxy id={id} position={layout.hit as [number, number, number]} size={layout.size as [number, number, number]} registerHit={registerHit} />
    </group>
  </>;
}

function DioramaFamiliar({ source, attentionId }: { source: Object3D; attentionId: RoomObjectId | null }) {
  const { invalidate } = useThree();
  const object = useMemo(() => source.clone(true), [source]);
  const rootRef = useRef<Object3D>(null);
  const target = roomFamiliarPose(attentionId
    ? ROOM_SCENE_OBJECTS[attentionId].layout.position[0] - manifest.familiar.position[0] : null);
  useEffect(() => { invalidate(); }, [attentionId, invalidate]);
  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    root.rotation.y = settleRoomPose(root.rotation.y, target.yaw, delta);
    root.rotation.z = settleRoomPose(root.rotation.z, target.roll, delta);
    if (root.rotation.y !== target.yaw || root.rotation.z !== target.roll) invalidate();
  });
  return <primitive ref={rootRef} object={object} dispose={null} />;
}

/** One shared, first-party GLB; all decoder bytes are bundled locally. */
export function DioramaObjects({ objectIds, focusedId, hoveredId, selectedId, registerHitTarget, registerOccluder, onLoaded }: {
  objectIds: readonly RoomObjectId[]; focusedId: RoomObjectId | null; hoveredId: RoomObjectId | null;
  selectedId: RoomObjectId | null; registerHitTarget: RegisterHit; registerOccluder: RegisterOccluder; onLoaded?: () => void;
}) {
  const { scene } = useLoader(GLTFLoader, manifest.assetPath, loader => loader.setMeshoptDecoder(MeshoptDecoder).register(roomAtlasPlugin));
  const shell = useMemo(() => scene.getObjectByName("room-shell")!.clone(), [scene]);
  useEffect(() => { onLoaded?.(); }, [scene, onLoaded]);
  return <>
    <primitive object={shell} dispose={null} />
    <DioramaFamiliar source={scene.getObjectByName("room-familiar")!} attentionId={selectedId ?? hoveredId ?? focusedId} />
    {manifest.occluders.map((occluder, index) => <Proxy key={index}
      position={occluder.position as [number, number, number]}
      size={occluder.size as [number, number, number]} registerOccluder={registerOccluder} />)}
    {objectIds.map(id => id === "rig"
      ? <RigRoomObject key={id} active={focusedId === id || hoveredId === id} selected={selectedId === id} registerHit={registerHitTarget} />
      : <DioramaProp key={id} id={id} source={scene.getObjectByName(`OBJ__${id}`)!}
      active={focusedId === id || hoveredId === id} selected={selectedId === id} registerHit={registerHitTarget} />)}
  </>;
}
