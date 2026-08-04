import {
  ROOM_OBJECT_IDS,
  type RoomFocusTargetRegistry,
  type RoomObjectDefinition,
  type RoomObjectId,
  type RoomObjectRegistry,
} from "./room-types";
import { SITE_COPY } from "@/lib/copy";

export const ROOM_OBJECT_BY_ID = {
  watch: {
    id: "watch",
    slug: "watch",
    route: "/play/watch",
    label: "Watch",
    roomLabel: "TV · Watch",
    provider: "myanimelist",
    providerLabel: "MyAnimeList",
    object: SITE_COPY.play["watch-title"],
    screenEyebrow: `${SITE_COPY.play["watch-screen-eyebrow"]} · MyAnimeList`,
    title: SITE_COPY.play["watch-screen-title"],
    description: SITE_COPY.play["watch-description"],
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
    providerLabel: "Hardcover",
    object: SITE_COPY.play["read-title"],
    screenEyebrow: `${SITE_COPY.play["read-screen-eyebrow"]} · Hardcover`,
    title: SITE_COPY.play["read-screen-title"],
    description: SITE_COPY.play["read-description"],
    approachPoseId: "read-approach",
    meshRoot: "OBJ__read",
    matchCutSurface: "open shelf",
  },
  listen: {
    id: "listen",
    slug: "listen",
    route: "/play/listen",
    label: "Listen",
    roomLabel: "Music player · Listen",
    provider: "spotify",
    providerLabel: "Spotify",
    object: SITE_COPY.play["listen-title"],
    screenEyebrow: `${SITE_COPY.play["listen-screen-eyebrow"]} · Spotify`,
    title: SITE_COPY.play["listen-screen-title"],
    description: SITE_COPY.play["listen-description"],
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
    providerLabel: "Discogs",
    object: SITE_COPY.play["collect-title"],
    screenEyebrow: `${SITE_COPY.play["collect-screen-eyebrow"]} · Discogs`,
    title: SITE_COPY.play["collect-screen-title"],
    description: SITE_COPY.play["collect-description"],
    approachPoseId: "collect-approach",
    meshRoot: "OBJ__collect",
    matchCutSurface: "record sleeve",
  },
  play: {
    id: "play",
    slug: "play",
    route: "/play/play",
    label: "Games",
    roomLabel: "Computer · Games",
    provider: "steam",
    providerLabel: "Steam",
    object: SITE_COPY.play["play-title"],
    screenEyebrow: `${SITE_COPY.play["play-screen-eyebrow"]} · Steam`,
    title: SITE_COPY.play["play-screen-title"],
    description: SITE_COPY.play["play-description"],
    approachPoseId: "play-approach",
    meshRoot: "OBJ__play",
    matchCutSurface: "computer display",
  },
  move: {
    id: "move",
    slug: "move",
    route: "/play/move",
    label: "Move",
    roomLabel: "Treadmill · Move",
    provider: "strava",
    providerLabel: "Strava",
    object: SITE_COPY.play["move-title"],
    screenEyebrow: `${SITE_COPY.play["move-screen-eyebrow"]} · Strava`,
    title: SITE_COPY.play["move-screen-title"],
    description: SITE_COPY.play["move-description"],
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
