import { Instance, Instances, RoundedBox } from "@react-three/drei";
import { type ThreeElements, useFrame, useThree } from "@react-three/fiber";
import { type Group, MathUtils, type Mesh } from "three";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

import type { RoomObjectId } from "../room-platform/room-types";
import {
  ROOM_BASIC_MATERIALS,
  ROOM_MATERIALS,
  type RoomMaterialKey,
} from "./room-materials";
import { ROOM_PALETTE as color } from "./room-palette";

export type HitTargetRegistration = (
  id: RoomObjectId,
  mesh: Mesh | null,
) => void;

export type OccluderRegistration = (mesh: Mesh, active: boolean) => void;

type ObjectProps = {
  active: boolean;
  registerHitTarget: HitTargetRegistration;
};

type SoftBoxProps = Omit<
  ThreeElements["mesh"],
  "args" | "children" | "material" | "ref"
> & {
  size: readonly [number, number, number];
  radius?: number;
  material: string;
  emissive?: string;
  emissiveIntensity?: number;
};

const MATERIAL_KEY_BY_COLOR = new Map<string, RoomMaterialKey>([
  [color.shell, "shell"],
  [color.shellLight, "shellLight"],
  [color.coral, "coral"],
  [color.mintDark, "mintDark"],
  [color.violet, "violet"],
  [color.violetDark, "violetDark"],
  [color.graphite, "graphite"],
  [color.graphiteSoft, "graphiteSoft"],
  [color.amber, "amber"],
  [color.wood, "wood"],
  [color.woodLight, "woodLight"],
  [color.beige, "beige"],
  [color.beigeDark, "beigeDark"],
  [color.paper, "paper"],
  [color.screen, "screen"],
]);

function sharedMaterial(
  material: string,
  emissive: string,
  emissiveIntensity: number,
) {
  if (emissiveIntensity > 0 && emissive === color.workBlue) {
    return ROOM_MATERIALS.screenBlue;
  }
  if (emissiveIntensity > 0 && emissive === color.mint) {
    return emissiveIntensity < 0.2
      ? ROOM_MATERIALS.screenPhosphor
      : ROOM_MATERIALS.screenMint;
  }

  const key = MATERIAL_KEY_BY_COLOR.get(material);
  if (!key) throw new Error("Unknown procedural room material.");
  return ROOM_MATERIALS[key];
}

function SoftBox({
  size,
  radius = 0.08,
  material,
  emissive = "#000000",
  emissiveIntensity = 0,
  ...props
}: SoftBoxProps) {
  return (
    <RoundedBox
      args={[size[0], size[1], size[2]]}
      radius={Math.min(radius, Math.min(...size) / 2)}
      smoothness={2}
      material={sharedMaterial(material, emissive, emissiveIntensity)}
      {...props}
    />
  );
}

function HitTarget({
  id,
  position,
  register,
  size,
}: {
  id: RoomObjectId;
  position: readonly [number, number, number];
  register: HitTargetRegistration;
  size: readonly [number, number, number];
}) {
  const ref = useRef<Mesh>(null);

  const connect = useCallback(
    (mesh: Mesh | null) => {
      ref.current = mesh;
      if (mesh) mesh.userData.roomObjectId = id;
      register(id, mesh);
    },
    [id, register],
  );

  useEffect(() => () => register(id, null), [id, register]);

  return (
    <mesh
      ref={connect}
      material={ROOM_BASIC_MATERIALS.invisible}
      position={position}
      renderOrder={-1}
      visible={false}
    >
      <boxGeometry args={[size[0], size[1], size[2]]} />
    </mesh>
  );
}

function Occluder({
  position,
  register,
  size,
}: {
  position: readonly [number, number, number];
  register: OccluderRegistration;
  size: readonly [number, number, number];
}) {
  const ref = useRef<Mesh>(null);

  const connect = useCallback(
    (mesh: Mesh | null) => {
      if (ref.current) register(ref.current, false);
      ref.current = mesh;
      if (mesh) {
        mesh.userData.roomOccluder = true;
        register(mesh, true);
      }
    },
    [register],
  );

  return (
    <mesh
      ref={connect}
      material={ROOM_BASIC_MATERIALS.invisible}
      position={position}
      renderOrder={-1}
      visible={false}
    >
      <boxGeometry args={[size[0], size[1], size[2]]} />
    </mesh>
  );
}

function SelectionMarker({ active, radius = 0.85 }: { active: boolean; radius?: number }) {
  return (
    <mesh
      position={[0, 0.035, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={ROOM_BASIC_MATERIALS.workBlue}
      visible={active}
    >
      <ringGeometry args={[radius, radius + 0.045, 32]} />
    </mesh>
  );
}

function ObjectRoot({
  active,
  activeTilt = 0,
  children,
  interactionTarget,
  position,
  rotation,
  scale,
}: {
  active: boolean;
  activeTilt?: number;
  children: ReactNode;
  interactionTarget: ReactNode;
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: number;
}) {
  const visual = useRef<Group>(null);
  const response = useRef(active ? 1 : 0);
  const { invalidate } = useThree();
  const baseScale = scale ?? 1;
  const baseRotation = rotation ?? [0, 0, 0];

  useEffect(() => invalidate(), [active, invalidate]);

  useFrame((_, delta) => {
    const object = visual.current;
    if (!object) return;
    const next = MathUtils.damp(response.current, active ? 1 : 0, 15, delta);
    response.current = next;
    object.position.set(0, next * 0.075, 0);
    object.rotation.set(0, 0, next * activeTilt);
    object.scale.setScalar(1 + next * 0.035);
    if (Math.abs(next - (active ? 1 : 0)) > 0.001) invalidate();
  }, -3);

  return (
    <group position={position} rotation={baseRotation} scale={baseScale}>
      {interactionTarget}
      <group
        position={[0, active ? 0.075 : 0, 0]}
        ref={visual}
        rotation={[0, 0, active ? activeTilt : 0]}
        scale={active ? 1.035 : 1}
      >
        {children}
      </group>
    </group>
  );
}

export function RoomShell({
  registerOccluder,
}: {
  registerOccluder: OccluderRegistration;
}) {
  return (
    <group>
      <Occluder
        position={[-4.76, 2.15, -0.2]}
        register={registerOccluder}
        size={[0.26, 4.65, 6.2]}
      />
      <Occluder
        position={[4.76, 2.05, -0.55]}
        register={registerOccluder}
        size={[0.24, 4.35, 5.35]}
      />
      <Occluder
        position={[-4, 0.32, 0.48]}
        register={registerOccluder}
        size={[1.55, 0.65, 2.62]}
      />
      <SoftBox
        material={color.shell}
        position={[0, -0.24, 0]}
        radius={0.3}
        size={[9.8, 0.42, 7.2]}
      />
      <SoftBox
        material={color.mintDark}
        position={[0, -0.015, 0.12]}
        radius={0.24}
        size={[8.95, 0.06, 6.25]}
      />
      <SoftBox
        material={color.shell}
        position={[0, 2.5, -3.42]}
        radius={0.22}
        size={[9.45, 5.35, 0.28]}
      />
      <SoftBox
        material={color.shell}
        position={[-4.76, 2.15, -0.2]}
        radius={0.25}
        size={[0.26, 4.65, 6.2]}
      />
      <SoftBox
        material={color.shell}
        position={[4.76, 2.05, -0.55]}
        radius={0.25}
        size={[0.24, 4.35, 5.35]}
      />
      <SoftBox
        material={color.coral}
        position={[2.92, 2.7, -3.245]}
        radius={0.16}
        size={[2.6, 3.65, 0.12]}
      />
      <SoftBox
        material={color.screen}
        position={[-2.48, 3.04, -3.245]}
        radius={0.12}
        size={[3.25, 1.62, 0.1]}
      />
      <SoftBox
        emissive={color.mint}
        emissiveIntensity={0.72}
        material={color.screen}
        position={[-2.48, 3.05, -3.185]}
        radius={0.02}
        size={[2.78, 0.075, 0.025]}
      />
      <Instances limit={5} material={ROOM_MATERIALS.graphite} range={5}>
        <boxGeometry args={[1, 1, 1]} />
        {[-0.72, -0.36, 0, 0.36, 0.72].map((offset) => (
          <Instance
            key={offset}
            position={[2.92 + offset, 1.63, -3.17]}
            scale={[0.18, 0.11, 0.05]}
          />
        ))}
      </Instances>
      <SoftBox
        emissive={color.coral}
        emissiveIntensity={0.42}
        material={color.screen}
        position={[0, 4.63, -3.19]}
        radius={0.03}
        size={[7.9, 0.08, 0.035]}
      />
      <Instances limit={8} material={ROOM_MATERIALS.shellLight} range={8}>
        <boxGeometry args={[1, 1, 1]} />
        <Instance position={[-4.35, 4.72, -0.3]} scale={[0.18, 0.18, 5.8]} />
        <Instance position={[0, 4.86, -3.08]} scale={[8.85, 0.2, 0.22]} />
        <Instance position={[4.35, 4.72, -0.3]} scale={[0.18, 0.18, 5.8]} />
        <Instance position={[2.4, 3.88, -3.16]} scale={[0.58, 0.1, 0.06]} />
        <Instance position={[2.4, 2.72, -3.16]} scale={[0.58, 0.1, 0.06]} />
        <Instance position={[2.13, 3.3, -3.16]} scale={[0.1, 1.08, 0.06]} />
        <Instance position={[2.67, 3.3, -3.16]} scale={[0.1, 1.08, 0.06]} />
        <Instance position={[3.48, 3.3, -3.16]} scale={[0.12, 1.22, 0.06]} />
      </Instances>
      <mesh material={ROOM_MATERIALS.shellLight} position={[0, 0.34, -3.28]}>
        <torusGeometry args={[4.15, 0.08, 6, 48, Math.PI]} />
      </mesh>
      <SoftBox
        emissive={color.mint}
        emissiveIntensity={0.58}
        material={color.screen}
        position={[0, 0.045, 2.58]}
        radius={0.02}
        size={[6.3, 0.035, 0.065]}
      />
      <SoftBox
        material={color.violetDark}
        position={[0.35, 0.035, 0.82]}
        radius={0.18}
        size={[3.25, 0.07, 2.18]}
      />
      <SoftBox
        material={color.graphite}
        position={[-4, 0.12, 0.48]}
        radius={0.12}
        size={[1.55, 0.25, 2.62]}
      />
      <SoftBox
        material={color.paper}
        position={[-4, 0.32, 0.48]}
        radius={0.14}
        size={[1.4, 0.22, 2.45]}
      />
      <SoftBox
        material={color.graphiteSoft}
        position={[-4, 0.53, -0.36]}
        radius={0.13}
        size={[1.3, 0.28, 0.72]}
      />
      <SoftBox
        material={color.coral}
        position={[-4, 0.69, -0.36]}
        radius={0.09}
        size={[1.05, 0.12, 0.54]}
      />
      <Instances limit={6} material={ROOM_BASIC_MATERIALS.shadow} range={6}>
        <circleGeometry args={[1, 24]} />
        <Instance
          position={[-3.22, 0.04, -2.72]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[1.1, 0.62, 1]}
        />
        <Instance
          position={[-0.35, 0.04, -2.92]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[1.08, 0.5, 1]}
        />
        <Instance
          position={[-1.28, 0.04, -0.42]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[0.82, 0.55, 1]}
        />
        <Instance
          position={[-2.82, 0.04, 1.54]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[1.05, 0.72, 1]}
        />
        <Instance
          position={[1.48, 0.04, 1.12]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[1.65, 1.05, 1]}
        />
        <Instance
          position={[3.48, 0.04, -1.58]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[1.18, 1.75, 1]}
        />
      </Instances>
    </group>
  );
}

export function WatchTelevision({ active, registerHitTarget }: ObjectProps) {
  return (
    <ObjectRoot
      active={active}
      activeTilt={-0.018}
      interactionTarget={
        <HitTarget
          id="watch"
          position={[0, 1.12, 0]}
          register={registerHitTarget}
          size={[1.72, 2.12, 1.0]}
        />
      }
      position={[-3.22, 0.56, -2.82]}
      rotation={[0, 0.18, 0]}
      scale={1.12}
    >
      <SelectionMarker active={active} radius={0.82} />
      <SoftBox
        material={color.shellLight}
        position={[0, -0.08, 0]}
        radius={0.08}
        size={[1.95, 0.16, 0.9]}
      />
      <SoftBox
        material={color.coral}
        position={[0, 0.32, 0]}
        size={[1.62, 0.58, 0.82]}
      />
      <SoftBox
        material={color.graphite}
        position={[0, 1.25, -0.02]}
        radius={0.14}
        size={[1.55, 1.28, 0.76]}
      />
      <SoftBox
        emissive={color.mint}
        emissiveIntensity={active ? 0.64 : 0.12}
        material={active ? "#356a67" : color.screen}
        position={[-0.13, 1.29, 0.382]}
        radius={0.13}
        size={[1.06, 0.77, 0.035]}
      />
      <mesh
        material={ROOM_MATERIALS.amber}
        position={[0.58, 1.46, 0.4]}
        rotation={[Math.PI / 2, 0, active ? 0.22 : 0]}
      >
        <cylinderGeometry args={[0.095, 0.095, 0.08, 16]} />
      </mesh>
      <mesh
        material={active ? ROOM_MATERIALS.workBlueGlow : ROOM_MATERIALS.graphiteSoft}
        position={[0.58, 1.1, 0.41]}
      >
        <sphereGeometry args={[0.065, 12, 8]} />
      </mesh>
      <group position={[0, 1.98, -0.08]}>
        <mesh
          material={ROOM_MATERIALS.shellLight}
          position={[-0.19, 0.18, 0]}
          rotation={[0, 0, -0.52]}
        >
          <cylinderGeometry args={[0.022, 0.022, 0.62, 8]} />
        </mesh>
        <mesh
          material={ROOM_MATERIALS.shellLight}
          position={[0.19, 0.18, 0]}
          rotation={[0, 0, 0.52]}
        >
          <cylinderGeometry args={[0.022, 0.022, 0.62, 8]} />
        </mesh>
      </group>
    </ObjectRoot>
  );
}

export function ReadingShelf({ active, registerHitTarget }: ObjectProps) {
  const books = [
    [-0.72, color.coral, 0.62],
    [-0.48, color.violet, 0.79],
    [-0.22, color.amber, 0.67],
    [0.04, color.graphiteSoft, 0.82],
    [0.31, color.workBlue, 0.71],
    [0.57, color.mintDark, 0.76],
    [0.78, color.coralDark, 0.61],
  ] as const;

  return (
    <ObjectRoot
      active={active}
      activeTilt={0.008}
      interactionTarget={
        <HitTarget
          id="read"
          position={[0, 1.5, 0]}
          register={registerHitTarget}
          size={[2.08, 3.05, 0.86]}
        />
      }
      position={[-0.35, 0, -2.94]}
      scale={1.06}
    >
      <SelectionMarker active={active} radius={1.05} />
      <Instances limit={3} material={ROOM_MATERIALS.wood} range={3}>
        <boxGeometry args={[1, 1, 1]} />
        <Instance position={[-0.94, 1.5, 0]} scale={[0.13, 2.9, 0.66]} />
        <Instance position={[0.94, 1.5, 0]} scale={[0.13, 2.9, 0.66]} />
        <Instance position={[0, 2.9, 0]} scale={[2.0, 0.14, 0.7]} />
      </Instances>
      <Instances limit={3} material={ROOM_MATERIALS.woodLight} range={3}>
        <boxGeometry args={[1, 1, 1]} />
        {[0.18, 1.05, 1.93].map((y) => (
          <Instance key={y} position={[0, y, 0]} scale={[2.0, 0.13, 0.7]} />
        ))}
      </Instances>
      <Instances limit={books.length} material={ROOM_MATERIALS.instanceColor} range={books.length}>
        <boxGeometry args={[1, 1, 1]} />
        {books.map(([x, material, height], index) => (
          <Instance
            key={`${x}-${height}`}
            color={material}
            position={[x, 1.48 + height / 2, active && index === 3 ? 0.17 : 0.04]}
            scale={[0.2, height, 0.45]}
          />
        ))}
      </Instances>
      <mesh
        material={active ? ROOM_MATERIALS.amberGlow : ROOM_MATERIALS.amber}
        position={[0.77, 2.62, 0.12]}
      >
        <sphereGeometry args={[0.13, 14, 10]} />
      </mesh>
    </ObjectRoot>
  );
}

export function PocketPlayer({ active, registerHitTarget }: ObjectProps) {
  return (
    <ObjectRoot
      active={active}
      activeTilt={-0.035}
      interactionTarget={
        <HitTarget
          id="listen"
          position={[0, 1.05, 0]}
          register={registerHitTarget}
          size={[1.18, 1.85, 0.88]}
        />
      }
      position={[-1.28, 0, -0.42]}
      rotation={[0, 0.16, 0]}
      scale={1.2}
    >
      <SelectionMarker active={active} radius={0.63} />
      <SoftBox material={color.graphiteSoft} position={[0, 0.42, 0]} size={[1.15, 0.74, 0.8]} />
      <SoftBox material={color.coral} position={[0, 0.82, 0.02]} size={[0.65, 0.22, 0.43]} />
      <group position={[0, active ? 1.32 : 1.21, 0.04]} rotation={[0, 0, active ? -0.06 : 0]}>
        <SoftBox material={color.violet} size={[0.75, 1.08, 0.2]} />
        <SoftBox
          emissive={active ? color.mint : "#000000"}
          emissiveIntensity={active ? 0.7 : 0}
          material={color.screen}
          position={[0, 0.25, 0.11]}
          size={[0.51, 0.34, 0.025]}
        />
        <mesh
          material={ROOM_MATERIALS.shellLight}
          position={[0, -0.24, 0.12]}
        >
          <torusGeometry args={[0.19, 0.055, 10, 24]} />
        </mesh>
      </group>
    </ObjectRoot>
  );
}

export function RecordCrate({ active, registerHitTarget }: ObjectProps) {
  const sleeveColors = [color.graphite, color.coral, color.amber, color.violet, color.paper] as const;
  return (
    <ObjectRoot
      active={active}
      activeTilt={0.015}
      interactionTarget={
        <HitTarget
          id="collect"
          position={[0, 0.68, 0]}
          register={registerHitTarget}
          size={[1.7, 1.42, 1.32]}
        />
      }
      position={[-2.82, 0, 1.54]}
      rotation={[0, 0.12, 0]}
      scale={1.08}
    >
      <SelectionMarker active={active} radius={0.86} />
      <Instances limit={3} material={ROOM_MATERIALS.wood} range={3}>
        <boxGeometry args={[1, 1, 1]} />
        <Instance position={[0, 0.1, 0]} scale={[1.5, 0.16, 1.1]} />
        {[-0.67, 0.67].map((x) => (
          <Instance key={x} position={[x, 0.6, 0]} scale={[0.16, 1.1, 1.1]} />
        ))}
      </Instances>
      <Instances limit={3} material={ROOM_MATERIALS.woodLight} range={3}>
        <boxGeometry args={[1, 1, 1]} />
        {[-0.46, 0, 0.46].map((z) => (
          <Instance key={z} position={[0, 0.58, z]} scale={[1.45, 0.11, 0.1]} />
        ))}
      </Instances>
      <Instances
        limit={sleeveColors.length}
        material={ROOM_MATERIALS.instanceColor}
        range={sleeveColors.length}
      >
        <boxGeometry args={[1, 1, 1]} />
        {sleeveColors.map((material, index) => (
          <Instance
            key={material}
            color={material}
            position={[0, active && index === 2 ? 1.03 : 0.88, -0.38 + index * 0.19]}
            rotation={[0, 0, -0.05 + index * 0.025]}
            scale={[1.08, 1.1, 0.055]}
          />
        ))}
      </Instances>
    </ObjectRoot>
  );
}

export function BeigeComputer({ active, registerHitTarget }: ObjectProps) {
  return (
    <ObjectRoot
      active={active}
      activeTilt={-0.008}
      interactionTarget={
        <HitTarget
          id="play"
          position={[-0.04, 1.48, 0]}
          register={registerHitTarget}
          size={[2.45, 1.92, 1.28]}
        />
      }
      position={[1.48, 0, 1.12]}
      rotation={[0, 0.22, 0]}
      scale={0.92}
    >
      <SelectionMarker active={active} radius={1.28} />
      <SoftBox material={color.shellLight} position={[0, 1.03, 0]} size={[2.45, 0.2, 1.12]} />
      <Instances limit={4} material={ROOM_MATERIALS.beigeDark} range={4}>
        <boxGeometry args={[1, 1, 1]} />
        {[-1.12, 1.12].flatMap((x) =>
          [-0.42, 0.42].map((z) => (
            <Instance
              key={`${x}-${z}`}
              position={[x, 0.52, z]}
              scale={[0.14, 1.0, 0.14]}
            />
          )),
        )}
      </Instances>
      <SoftBox material={color.beige} position={[0.2, 1.78, -0.15]} size={[1.34, 1.12, 0.56]} />
      <SoftBox
        emissive={color.mint}
        emissiveIntensity={active ? 0.58 : 0.12}
        material={active ? "#356a67" : color.screen}
        position={[0.2, 1.82, 0.145]}
        radius={0.08}
        size={[1.01, 0.76, 0.025]}
      />
      <SoftBox material={color.beigeDark} position={[0.2, 1.17, -0.12]} size={[0.22, 0.25, 0.2]} />
      <SoftBox material={color.beige} position={[-0.88, 1.55, -0.08]} size={[0.52, 1.02, 0.65]} />
      <SoftBox material={color.beige} position={[0.3, 1.14, 0.38]} size={[1.28, 0.09, 0.39]} />
      <mesh
        material={active ? ROOM_MATERIALS.workBlueGlow : ROOM_MATERIALS.graphiteSoft}
        position={[-0.73, 1.2, 0.36]}
      >
        <sphereGeometry args={[0.055, 12, 8]} />
      </mesh>
    </ObjectRoot>
  );
}

export function CardioTelevision({ active, registerHitTarget }: ObjectProps) {
  return (
    <ObjectRoot
      active={active}
      activeTilt={0.012}
      interactionTarget={
        <HitTarget
          id="move"
          position={[0, 1.12, -0.34]}
          register={registerHitTarget}
          size={[1.58, 2.22, 2.68]}
        />
      }
      position={[3.48, 0, -1.95]}
      rotation={[0, 0.12, 0]}
      scale={1.12}
    >
      <SelectionMarker active={active} radius={1.05} />
      <SoftBox material={color.graphiteSoft} position={[0, 0.2, 0.35]} size={[1.2, 0.22, 2.4]} />
      <SoftBox
        material={color.graphite}
        position={[0, active ? 0.35 : 0.29, 0.33]}
        size={[0.95, 0.08, 1.9]}
      />
      <Instances limit={4} material={ROOM_MATERIALS.shellLight} range={4}>
        <boxGeometry args={[1, 1, 1]} />
        {[-0.5, 0.5].flatMap((x) => [
          <Instance
            key={`${x}-upright`}
            position={[x, 0.85, -0.5]}
            scale={[0.11, 1.45, 0.11]}
          />,
          <Instance
            key={`${x}-rail`}
            position={[x, 1.45, -0.95]}
            rotation={[0.72, 0, 0]}
            scale={[0.11, 0.11, 1.2]}
          />,
        ])}
      </Instances>
      <SoftBox material={color.graphite} position={[0, 2.03, -1.1]} size={[1.36, 0.84, 0.3]} />
      <SoftBox
        emissive={active ? color.workBlue : color.mint}
        emissiveIntensity={active ? 0.55 : 0.12}
        material={active ? "#44547e" : color.screen}
        position={[0, 2.04, -0.935]}
        size={[1.06, 0.58, 0.025]}
      />
    </ObjectRoot>
  );
}
