import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { MathUtils, type Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { RoomObjectId } from "../room-platform/room-types";
import manifest from "./diorama.generated.json";

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
  source: Object3D; id: RoomObjectId; active: boolean; selected: boolean; registerHit: RegisterHit;
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
    if (id === "read") moving.position.z += .2 * t;
    if (id === "listen") moving.position.z -= .025 * t;
    if (id === "collect") moving.rotation.z = -.6 * t;
    if (id === "travel") moving.rotation.y = Math.PI * 1.8 * t;
    if (id === "watch" || id === "play" || id === "move") moving.visible = t > .05;
    root.scale.setScalar(layout.scale * (1 + .012 * t));
    if (response.current !== target) invalidate();
  });
  return <>
    <primitive ref={rootRef} object={object} dispose={null} />
    <group position={layout.position as [number, number, number]} rotation={[0, layout.rotation, 0]} scale={layout.scale}>
      <Proxy id={id} position={layout.hit as [number, number, number]} size={layout.size as [number, number, number]} registerHit={registerHit} />
    </group>
  </>;
}

/** One shared, first-party GLB; all decoder bytes are bundled locally. */
export function DioramaObjects({ objectIds, focusedId, hoveredId, selectedId, registerHitTarget, registerOccluder, onLoaded }: {
  objectIds: readonly RoomObjectId[]; focusedId: RoomObjectId | null; hoveredId: RoomObjectId | null;
  selectedId: RoomObjectId | null; registerHitTarget: RegisterHit; registerOccluder: RegisterOccluder; onLoaded?: () => void;
}) {
  const { scene } = useLoader(GLTFLoader, manifest.assetPath, loader => loader.setMeshoptDecoder(MeshoptDecoder));
  const shell = useMemo(() => scene.getObjectByName("room-shell")!.clone(), [scene]);
  useEffect(() => { onLoaded?.(); }, [scene, onLoaded]);
  return <>
    <primitive object={shell} dispose={null} />
    <Proxy position={[-4.76, 2.15, -.2]} size={[.26, 4.65, 6.2]} registerOccluder={registerOccluder} />
    <Proxy position={[4.76, 2.05, -.55]} size={[.24, 4.35, 5.35]} registerOccluder={registerOccluder} />
    <Proxy position={[-4, .32, .48]} size={[1.55, .65, 2.62]} registerOccluder={registerOccluder} />
    {objectIds.map(id => <DioramaProp key={id} id={id} source={scene.getObjectByName(`OBJ__${id}`)!}
      active={focusedId === id || hoveredId === id} selected={selectedId === id} registerHit={registerHitTarget} />)}
  </>;
}
