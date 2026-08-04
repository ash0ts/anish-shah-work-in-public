import {
  type RoomFocusTargetRegistry,
  type RoomObjectDefinition,
  type RoomObjectId,
  type RoomObjectRegistry,
} from "./room-types";
import {
  ROOM_OBJECT_CONTRACT,
  isRoomObjectId,
} from "./room-object-contract";
import { SITE_COPY } from "@/lib/copy";

const ROOM_OBJECT_PRESENTATION_BY_ID = {
  watch: {
    label: "Watch",
    roomLabel: `${SITE_COPY.play["watch-title"]} · Watch`,
    object: SITE_COPY.play["watch-title"],
    screenEyebrow: `${SITE_COPY.play["watch-screen-eyebrow"]} · MyAnimeList`,
    title: SITE_COPY.play["watch-screen-title"],
    description: SITE_COPY.play["watch-description"],
  },
  read: {
    label: "Read",
    roomLabel: `${SITE_COPY.play["read-title"]} · Read`,
    object: SITE_COPY.play["read-title"],
    screenEyebrow: `${SITE_COPY.play["read-screen-eyebrow"]} · Hardcover`,
    title: SITE_COPY.play["read-screen-title"],
    description: SITE_COPY.play["read-description"],
  },
  listen: {
    label: "Listen",
    roomLabel: `${SITE_COPY.play["listen-title"]} · Listen`,
    object: SITE_COPY.play["listen-title"],
    screenEyebrow: `${SITE_COPY.play["listen-screen-eyebrow"]} · Spotify`,
    title: SITE_COPY.play["listen-screen-title"],
    description: SITE_COPY.play["listen-description"],
  },
  collect: {
    label: "Collect",
    roomLabel: `${SITE_COPY.play["collect-title"]} · Collect`,
    object: SITE_COPY.play["collect-title"],
    screenEyebrow: `${SITE_COPY.play["collect-screen-eyebrow"]} · Discogs`,
    title: SITE_COPY.play["collect-screen-title"],
    description: SITE_COPY.play["collect-description"],
  },
  play: {
    label: "Games",
    roomLabel: `${SITE_COPY.play["play-title"]} · Games`,
    object: SITE_COPY.play["play-title"],
    screenEyebrow: `${SITE_COPY.play["play-screen-eyebrow"]} · Steam`,
    title: SITE_COPY.play["play-screen-title"],
    description: SITE_COPY.play["play-description"],
  },
  move: {
    label: "Move",
    roomLabel: `${SITE_COPY.play["move-title"]} · Move`,
    object: SITE_COPY.play["move-title"],
    screenEyebrow: `${SITE_COPY.play["move-screen-eyebrow"]} · Strava`,
    title: SITE_COPY.play["move-screen-title"],
    description: SITE_COPY.play["move-description"],
  },
  travel: {
    label: "Travel",
    roomLabel: `${SITE_COPY.play["travel-title"]} · Travel`,
    object: SITE_COPY.play["travel-title"],
    screenEyebrow: `${SITE_COPY.play["travel-screen-eyebrow"]} · Approximate public geography`,
    title: SITE_COPY.play["travel-screen-title"],
    description: SITE_COPY.play["travel-description"],
  },
} as const satisfies Record<
  RoomObjectId,
  Pick<
    RoomObjectDefinition,
    | "label"
    | "roomLabel"
    | "object"
    | "screenEyebrow"
    | "title"
    | "description"
  >
>;

export const ROOM_OBJECT_BY_ID = Object.fromEntries(
  ROOM_OBJECT_CONTRACT.map((structural) => [
    structural.id,
    {
      ...structural,
      slug: structural.id,
      ...ROOM_OBJECT_PRESENTATION_BY_ID[structural.id],
    },
  ]),
) as unknown as RoomObjectRegistry & Record<RoomObjectId, RoomObjectDefinition>;

export const ROOM_OBJECTS: ReadonlyArray<RoomObjectDefinition> =
  ROOM_OBJECT_CONTRACT.map(({ id }) => ROOM_OBJECT_BY_ID[id]);

export const ROOM_FOCUS_TARGET_BY_ID = Object.fromEntries(
  ROOM_OBJECT_CONTRACT.map(({ id, focusTarget }) => [id, focusTarget]),
) as RoomFocusTargetRegistry;

export { isRoomObjectId } from "./room-object-contract";

export function roomObject(value: string): RoomObjectDefinition | null {
  return isRoomObjectId(value) ? ROOM_OBJECT_BY_ID[value] : null;
}
