export const ROOM_OBJECT_IDS = [
  "watch",
  "read",
  "listen",
  "collect",
  "play",
  "move",
  "travel",
] as const;

export type RoomObjectId = (typeof ROOM_OBJECT_IDS)[number];

export type RoomConnectorObjectId = Exclude<RoomObjectId, "travel">;

export type RoomProviderById = {
  watch: "myanimelist";
  read: "hardcover";
  listen: "spotify";
  collect: "discogs";
  play: "steam";
  move: "strava";
};

export type RoomProviderId = RoomProviderById[RoomConnectorObjectId];

export type RoomContentSourceById = {
  readonly [Id in RoomConnectorObjectId]: {
    kind: "connector";
    provider: RoomProviderById[Id];
  };
} & {
  readonly travel: { kind: "travel-log" };
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
  route: `/play/${Id}`;
  label: string;
  roomLabel: string;
  contentSource: RoomContentSourceById[Id];
  object: string;
  screenEyebrow: string;
  title: string;
  description: string;
  approachPoseId: `${Id}-approach`;
  meshRoot: `OBJ__${Id}`;
  matchCutSurface: string;
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
