import {
  ROOM_OBJECT_IDS,
  type RoomFocusTargetRegistry,
  type RoomObjectDefinition,
  type RoomObjectId,
  type RoomObjectRegistry,
} from "./room-types";

export const ROOM_OBJECT_BY_ID = {
  watch: {
    id: "watch",
    slug: "watch",
    route: "/play/watch",
    label: "Watch",
    roomLabel: "Television · Watch",
    provider: "myanimelist",
    object: "Graphite television",
    title: "Midnight Broadcast",
    description:
      "Anime seasons, watch states, recurring genres, and the full public shelf.",
    approachPoseId: "watch-approach",
    meshRoot: "OBJ__watch",
    matchCutSurface: "television glass",
  },
  read: {
    id: "read",
    slug: "read",
    route: "/play/read",
    label: "Read",
    roomLabel: "Bookshelf · Read",
    provider: "hardcover",
    object: "Wooden bookshelf",
    title: "Borrowed Shelf",
    description:
      "Reading states, recent books, ratings, and the complete public shelf.",
    approachPoseId: "read-approach",
    meshRoot: "OBJ__read",
    matchCutSurface: "open shelf",
  },
  listen: {
    id: "listen",
    slug: "listen",
    route: "/play/listen",
    label: "Listen",
    roomLabel: "Pocket player · Listen",
    provider: "spotify",
    object: "Pocket music player",
    title: "Pocket Player",
    description:
      "Spotify-calculated Top Tracks in their returned order, never inferred play counts.",
    approachPoseId: "listen-approach",
    meshRoot: "OBJ__listen",
    matchCutSurface: "player display",
  },
  collect: {
    id: "collect",
    slug: "collect",
    route: "/play/collect",
    label: "Collect",
    roomLabel: "Record crate · Collect",
    provider: "discogs",
    object: "Record crate",
    title: "Crate Archive",
    description:
      "A physical record catalog organized by format and decade.",
    approachPoseId: "collect-approach",
    meshRoot: "OBJ__collect",
    matchCutSurface: "record sleeve",
  },
  play: {
    id: "play",
    slug: "play",
    route: "/play/play",
    label: "Play",
    roomLabel: "Computer · Play",
    provider: "steam",
    object: "Beige computer",
    title: "Desktop Library",
    description:
      "A public game library, recent sessions, and deliberately rounded playtime.",
    approachPoseId: "play-approach",
    meshRoot: "OBJ__play",
    matchCutSurface: "computer display",
  },
  move: {
    id: "move",
    slug: "move",
    route: "/play/move",
    label: "Move",
    roomLabel: "Treadmill television · Move",
    provider: "strava",
    object: "Cardio television",
    title: "Cardio Television",
    description:
      "An official public movement feed, loaded only after visitor consent.",
    approachPoseId: "move-approach",
    meshRoot: "OBJ__move",
    matchCutSurface: "treadmill display",
  },
} as const satisfies RoomObjectRegistry &
  Record<RoomObjectId, RoomObjectDefinition>;

export const ROOM_OBJECTS: ReadonlyArray<RoomObjectDefinition> =
  ROOM_OBJECT_IDS.map((id) => ROOM_OBJECT_BY_ID[id]);

export const ROOM_FOCUS_TARGET_BY_ID = {
  watch: '[data-room-object-link="watch"]',
  read: '[data-room-object-link="read"]',
  listen: '[data-room-object-link="listen"]',
  collect: '[data-room-object-link="collect"]',
  play: '[data-room-object-link="play"]',
  move: '[data-room-object-link="move"]',
} as const satisfies RoomFocusTargetRegistry &
  Record<
    RoomObjectId,
    `[data-room-object-link="${RoomObjectId}"]`
  >;

export function isRoomObjectId(value: unknown): value is RoomObjectId {
  return typeof value === "string" && Object.hasOwn(ROOM_OBJECT_BY_ID, value);
}

export function roomObject(value: string): RoomObjectDefinition | null {
  return isRoomObjectId(value) ? ROOM_OBJECT_BY_ID[value] : null;
}
