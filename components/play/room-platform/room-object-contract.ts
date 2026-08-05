/**
 * Dependency-free structural contract for every public room object.
 *
 * Server routes, semantic controls, focus targets, smoke checks, and the
 * client registries all derive from this list. Executable imports remain in
 * explicit allowlisted maps and are checked against the derived id union.
 */
export const ROOM_OBJECT_CONTRACT = [
  {
    id: "watch",
    route: "/play/watch",
    contentSource: { kind: "connector", provider: "myanimelist" },
    approachPoseId: "watch-approach",
    meshRoot: "OBJ__watch",
    matchCutSurface: "television glass",
    focusTarget: '[data-room-object-link="watch"]',
    smokeTest: "play_watch",
  },
  {
    id: "read",
    route: "/play/read",
    contentSource: { kind: "connector", provider: "hardcover" },
    approachPoseId: "read-approach",
    meshRoot: "OBJ__read",
    matchCutSurface: "open shelf",
    focusTarget: '[data-room-object-link="read"]',
    smokeTest: "play_read",
  },
  {
    id: "listen",
    route: "/play/listen",
    contentSource: { kind: "connector", provider: "spotify" },
    approachPoseId: "listen-approach",
    meshRoot: "OBJ__listen",
    matchCutSurface: "player display",
    focusTarget: '[data-room-object-link="listen"]',
    smokeTest: "play_listen",
  },
  {
    id: "collect",
    route: "/play/collect",
    contentSource: { kind: "connector", provider: "discogs" },
    approachPoseId: "collect-approach",
    meshRoot: "OBJ__collect",
    matchCutSurface: "record sleeve",
    focusTarget: '[data-room-object-link="collect"]',
    smokeTest: "play_collect",
  },
  {
    id: "play",
    route: "/play/play",
    contentSource: { kind: "connector", provider: "steam" },
    approachPoseId: "play-approach",
    meshRoot: "OBJ__play",
    matchCutSurface: "computer display",
    focusTarget: '[data-room-object-link="play"]',
    smokeTest: "play_play",
  },
  {
    id: "move",
    route: "/play/move",
    contentSource: { kind: "connector", provider: "strava" },
    approachPoseId: "move-approach",
    meshRoot: "OBJ__move",
    matchCutSurface: "treadmill display",
    focusTarget: '[data-room-object-link="move"]',
    smokeTest: "play_move",
  },
  {
    id: "travel",
    route: "/play/travel",
    contentSource: { kind: "travel-log" },
    approachPoseId: "travel-approach",
    meshRoot: "OBJ__travel",
    matchCutSurface: "globe surface",
    focusTarget: '[data-room-object-link="travel"]',
    smokeTest: "play_travel",
  },
] as const;

export type RoomObjectContract = (typeof ROOM_OBJECT_CONTRACT)[number];
export type RoomObjectId = RoomObjectContract["id"];
export type RoomObjectRoute = RoomObjectContract["route"];

export const ROOM_OBJECT_IDS = ROOM_OBJECT_CONTRACT.map(({ id }) => id) as
  readonly RoomObjectId[];

export const ROOM_OBJECT_ROUTES = ROOM_OBJECT_CONTRACT.map(({ route }) => route) as
  readonly RoomObjectRoute[];

export const ROOM_OBJECT_CONTRACT_BY_ID = Object.fromEntries(
  ROOM_OBJECT_CONTRACT.map((object) => [object.id, object]),
) as { readonly [Id in RoomObjectId]: Extract<RoomObjectContract, { id: Id }> };

export function isRoomObjectId(value: unknown): value is RoomObjectId {
  return (
    typeof value === "string" && Object.hasOwn(ROOM_OBJECT_CONTRACT_BY_ID, value)
  );
}

export function roomObjectContract(value: unknown): RoomObjectContract | null {
  return isRoomObjectId(value) ? ROOM_OBJECT_CONTRACT_BY_ID[value] : null;
}
