import type { RoomObjectId } from "./room-types";

type RoomScreenLoader = () => Promise<unknown>;

/**
 * Closed client-screen import boundary. A validated RoomObjectId can select one
 * of these literal imports; URL, provider, and mesh metadata never become an
 * import specifier.
 */
export const ROOM_SCREEN_LOADERS = {
  watch: () => import("../room-screens/WatchRoomScreen"),
  read: () => import("../room-screens/ReadRoomScreen"),
  listen: () => import("../room-screens/ListenRoomScreen"),
  collect: () => import("../room-screens/CollectRoomScreen"),
  play: () => import("../room-screens/PlayRoomScreen"),
  move: () => import("../room-screens/MoveRoomScreen"),
  travel: () => import("../room-screens/TravelRoomScreen"),
} satisfies Record<RoomObjectId, RoomScreenLoader>;
