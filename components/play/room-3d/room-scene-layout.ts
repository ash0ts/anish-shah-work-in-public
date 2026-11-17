import manifest from "./diorama.generated.json" with { type: "json" };
import type { RoomObjectId } from "../room-platform/room-object-contract.ts";

type Layout = { position: readonly number[]; rotation: number; scale: number; hit: readonly number[]; size: readonly number[] };
type SceneObject = { kind: "glb" | "code"; layout: Layout };

/** Explicit rendering ownership. The baked asset manifest describes only its own bytes. */
export const ROOM_SCENE_OBJECTS = {
  watch: { kind: "glb", layout: manifest.props.watch },
  read: { kind: "glb", layout: manifest.props.read },
  listen: { kind: "glb", layout: manifest.props.listen },
  collect: { kind: "glb", layout: manifest.props.collect },
  play: { kind: "glb", layout: manifest.props.play },
  move: { kind: "glb", layout: manifest.props.move },
  travel: { kind: "glb", layout: manifest.props.travel },
  rig: {
    kind: "code",
    layout: { position: [0.6, 0, 2.95], rotation: 0.05, scale: 1, hit: [0, 0.96, 0], size: [2.7, 1.92, 1.12] },
  },
} as const satisfies Record<RoomObjectId, SceneObject>;

export type BakedRoomObjectId = { [Id in RoomObjectId]:
  (typeof ROOM_SCENE_OBJECTS)[Id]["kind"] extends "glb" ? Id : never
}[RoomObjectId];

export const BAKED_ROOM_OBJECT_IDS = (Object.keys(ROOM_SCENE_OBJECTS) as RoomObjectId[])
  .filter((id): id is BakedRoomObjectId => ROOM_SCENE_OBJECTS[id].kind === "glb");
