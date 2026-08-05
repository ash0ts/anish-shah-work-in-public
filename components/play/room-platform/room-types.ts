import type {
  RoomObjectContract,
  RoomObjectId,
} from "./room-object-contract";

export { ROOM_OBJECT_IDS } from "./room-object-contract";
export type { RoomObjectId } from "./room-object-contract";

export type RoomConnectorObjectId = Exclude<RoomObjectId, "travel">;

export type RoomProviderById = {
  readonly [Id in RoomConnectorObjectId]: Extract<
    RoomObjectContract,
    { id: Id }
  >["contentSource"]["provider"];
};

export type RoomProviderId = RoomProviderById[RoomConnectorObjectId];

export type RoomContentSourceById = {
  readonly [Id in RoomObjectId]: Extract<
    RoomObjectContract,
    { id: Id }
  >["contentSource"];
};

export type RoomContentSource =
  RoomContentSourceById[keyof RoomContentSourceById];

export type RoomRotation = {
  /** Polar rotation, in degrees. */
  x: number;
  /** Azimuth rotation, in degrees. */
  y: number;
};

export type RoomObjectDefinition<Id extends RoomObjectId = RoomObjectId> = {
  id: Id;
  slug: Id;
  route: Extract<RoomObjectContract, { id: Id }>["route"];
  label: string;
  roomLabel: string;
  contentSource: Extract<RoomObjectContract, { id: Id }>["contentSource"];
  object: string;
  screenEyebrow: string;
  title: string;
  description: string;
  approachPoseId: Extract<RoomObjectContract, { id: Id }>["approachPoseId"];
  meshRoot: Extract<RoomObjectContract, { id: Id }>["meshRoot"];
  matchCutSurface: Extract<RoomObjectContract, { id: Id }>["matchCutSurface"];
};

export type RoomObjectRegistry = {
  readonly [Id in RoomObjectId]: RoomObjectDefinition<Id>;
};

export type RoomFocusTargetRegistry = {
  readonly [Id in RoomObjectId]: `[data-room-object-link="${Id}"]`;
};

export type RoomTransitionPhase =
  | "idle"
  | "acknowledging"
  | "approaching"
  | "navigating"
  | "presenting"
  | "returning";

export type RoomExperienceState = {
  entered: boolean;
  selectedId: RoomObjectId | null;
  focusedId: RoomObjectId | null;
  phase: RoomTransitionPhase;
  transitionEpoch: number;
  rotation: RoomRotation;
  fallbackReason: string | null;
};

export type RoomExperienceAction =
  | { type: "enter" }
  | { type: "focus"; id: RoomObjectId | null }
  | { type: "select"; id: RoomObjectId }
  | { type: "phase"; phase: RoomTransitionPhase; epoch: number }
  | { type: "route"; id: RoomObjectId | null }
  | { type: "return" }
  | { type: "exit" }
  | { type: "rotate"; rotation: RoomRotation }
  | { type: "reset-view" }
  | { type: "fallback"; reason: string };
