import { Instance, Instances, RoundedBox } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import type { Mesh } from "three";
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
  opacity?: number;
};

const MATERIAL_KEY_BY_COLOR = new Map<string, RoomMaterialKey>([
  [color.shell, "shell"],
  [color.shellLight, "shellLight"],
  [color.coral, "coral"],
  [color.mint, "mint"],
  [color.violet, "violet"],
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
  opacity: number,
) {
  if (opacity < 1 && material === color.violet) {
    return ROOM_MATERIALS.violetGlass;
  }
  if (emissiveIntensity > 0 && emissive === color.anime) {
    return ROOM_MATERIALS.screenAnime;
  }
  if (emissiveIntensity > 0 && emissive === color.workBlue) {
    return ROOM_MATERIALS.screenBlue;
  }
  if (emissiveIntensity > 0 && emissive === color.mint) {
    return ROOM_MATERIALS.screenMint;
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
  opacity = 1,
  ...props
}: SoftBoxProps) {
  return (
    <RoundedBox
      args={[size[0], size[1], size[2]]}
      radius={Math.min(radius, Math.min(...size) / 2)}
      smoothness={2}
      material={sharedMaterial(material, emissive, emissiveIntensity, opacity)}
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
  children,
  position,
  rotation,
  scale,
}: {
  active: boolean;
  children: ReactNode;
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: number;
}) {
  const activeScale = active ? 1.022 : 1;
  return (
    <group
      position={position}
      rotation={rotation ?? [0, 0, 0]}
      scale={(scale ?? 1) * activeScale}
    >
      {children}
    </group>
  );
}

export function RoomShell() {
  return (
    <group>
      <SoftBox
        material={color.mint}
        position={[0, -0.22, 0]}
        radius={0.3}
        size={[9.8, 0.42, 7.2]}
      />
      <SoftBox
        material={color.shellLight}
        position={[-2.6, 2.45, -3.38]}
        radius={0.22}
        size={[4.7, 5.25, 0.28]}
      />
      <SoftBox
        material={color.coral}
        position={[2.45, 2.45, -3.38]}
        radius={0.22}
        size={[5.35, 5.25, 0.28]}
      />
      <SoftBox
        material={color.shell}
        position={[-4.76, 2.15, -0.2]}
        radius={0.25}
        size={[0.26, 4.65, 6.2]}
      />
      <SoftBox
        material={color.shell}
        position={[4.76, 1.5, -1.45]}
        radius={0.25}
        size={[0.24, 3.25, 3.7]}
      />
      <SoftBox
        material={color.violet}
        opacity={0.72}
        position={[0.1, 0.035, 0.75]}
        radius={0.28}
        size={[3.1, 0.07, 2.15]}
      />
      <SoftBox
        material={color.woodLight}
        position={[-3.55, 0.12, -0.18]}
        radius={0.12}
        size={[1.9, 0.25, 3.05]}
      />
      <SoftBox
        material={color.paper}
        position={[-3.55, 0.32, -0.18]}
        radius={0.14}
        size={[1.72, 0.22, 2.86]}
      />
      <SoftBox
        material={color.coral}
        position={[-3.55, 0.53, -1.15]}
        radius={0.13}
        size={[1.55, 0.28, 0.72]}
      />
    </group>
  );
}

export function WatchTelevision({ active, registerHitTarget }: ObjectProps) {
  return (
    <ObjectRoot active={active} position={[-3.38, 0, -2.48]}>
      <SelectionMarker active={active} radius={0.82} />
      <SoftBox
        material={color.wood}
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
        emissive={active ? color.anime : color.screen}
        emissiveIntensity={active ? 0.26 : 0.03}
        material={active ? "#5a4765" : color.screen}
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
      <HitTarget
        id="watch"
        position={[0, 1.12, 0]}
        register={registerHitTarget}
        size={[1.9, 2.25, 1.15]}
      />
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
    <ObjectRoot active={active} position={[-0.62, 0, -2.84]}>
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
      <HitTarget
        id="read"
        position={[0, 1.5, 0]}
        register={registerHitTarget}
        size={[2.25, 3.15, 1.0]}
      />
    </ObjectRoot>
  );
}

export function PocketPlayer({ active, registerHitTarget }: ObjectProps) {
  return (
    <ObjectRoot active={active} position={[-0.66, 0, -0.26]}>
      <SelectionMarker active={active} radius={0.63} />
      <SoftBox material={color.shell} position={[0, 0.42, 0]} size={[1.15, 0.74, 0.8]} />
      <SoftBox material={color.graphiteSoft} position={[0, 0.82, 0.02]} size={[0.65, 0.22, 0.43]} />
      <group position={[0, active ? 1.32 : 1.21, 0.04]} rotation={[0, 0, active ? -0.06 : 0]}>
        <SoftBox material={color.violet} opacity={0.82} size={[0.75, 1.08, 0.2]} />
        <SoftBox
          emissive={active ? color.workBlue : "#000000"}
          emissiveIntensity={active ? 0.7 : 0}
          material={color.screen}
          position={[0, 0.25, 0.11]}
          size={[0.51, 0.34, 0.025]}
        />
        <mesh
          material={ROOM_MATERIALS.shellLight}
          position={[0, -0.24, 0.12]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.19, 0.055, 10, 24]} />
        </mesh>
      </group>
      <HitTarget
        id="listen"
        position={[0, 1.05, 0]}
        register={registerHitTarget}
        size={[1.4, 1.9, 1.1]}
      />
    </ObjectRoot>
  );
}

export function RecordCrate({ active, registerHitTarget }: ObjectProps) {
  const sleeveColors = [color.graphite, color.coral, color.amber, color.violet, color.paper] as const;
  return (
    <ObjectRoot active={active} position={[-2.55, 0, 1.62]} rotation={[0, 0.16, 0]}>
      <SelectionMarker active={active} radius={0.86} />
      <Instances limit={3} material={ROOM_MATERIALS.graphite} range={3}>
        <boxGeometry args={[1, 1, 1]} />
        <Instance position={[0, 0.1, 0]} scale={[1.5, 0.16, 1.1]} />
        {[-0.67, 0.67].map((x) => (
          <Instance key={x} position={[x, 0.6, 0]} scale={[0.16, 1.1, 1.1]} />
        ))}
      </Instances>
      <Instances limit={3} material={ROOM_MATERIALS.graphiteSoft} range={3}>
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
            position={[-0.39 + index * 0.2, active && index === 2 ? 1.03 : 0.88, 0]}
            rotation={[0, 0, -0.05 + index * 0.025]}
            scale={[0.07, 1.1, 0.88]}
          />
        ))}
      </Instances>
      <HitTarget
        id="collect"
        position={[0, 0.68, 0]}
        register={registerHitTarget}
        size={[1.9, 1.55, 1.5]}
      />
    </ObjectRoot>
  );
}

export function BeigeComputer({ active, registerHitTarget }: ObjectProps) {
  return (
    <ObjectRoot active={active} position={[2.1, 0, 0.88]} rotation={[0, -0.08, 0]}>
      <SelectionMarker active={active} radius={1.28} />
      <SoftBox material={color.shellLight} position={[0, 1.03, 0]} size={[2.7, 0.2, 1.12]} />
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
        emissive={active ? color.workBlue : "#000000"}
        emissiveIntensity={active ? 0.28 : 0}
        material={active ? "#44547e" : color.screen}
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
      <HitTarget
        id="play"
        position={[0, 1.25, 0]}
        register={registerHitTarget}
        size={[3.05, 2.6, 1.65]}
      />
    </ObjectRoot>
  );
}

export function CardioTelevision({ active, registerHitTarget }: ObjectProps) {
  return (
    <ObjectRoot active={active} position={[3.18, 0, -1.87]} rotation={[0, -0.22, 0]}>
      <SelectionMarker active={active} radius={1.05} />
      <SoftBox material={color.graphiteSoft} position={[0, 0.2, 0.35]} size={[1.2, 0.22, 2.4]} />
      <SoftBox
        material={color.graphite}
        position={[0, active ? 0.35 : 0.29, 0.33]}
        size={[0.95, 0.08, 1.9]}
      />
      <Instances limit={4} material={ROOM_MATERIALS.graphiteSoft} range={4}>
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
      <SoftBox material={color.graphite} position={[0, 1.85, -1.38]} size={[1.36, 0.84, 0.3]} />
      <SoftBox
        emissive={active ? color.mint : "#000000"}
        emissiveIntensity={active ? 0.55 : 0}
        material={active ? "#356a67" : color.screen}
        position={[0, 1.86, -1.215]}
        size={[1.06, 0.58, 0.025]}
      />
      <HitTarget
        id="move"
        position={[0, 1.05, -0.25]}
        register={registerHitTarget}
        size={[1.75, 2.35, 3.05]}
      />
    </ObjectRoot>
  );
}
