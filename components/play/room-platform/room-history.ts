import { isRoomObjectId } from "./room-object-contract.ts";
import type { RoomObjectId } from "./room-types";

const ROOM_HISTORY_ORIGIN_KEY = "__anishRoomOrigin";
const ROOM_HISTORY_DEPTH_KEY = "__anishRoomDepth";
const ROOM_HISTORY_PATH_KEY = "__anishRoomPath";

export function routeObject(pathname: string): RoomObjectId | null {
  if (/^\/play\/travel\/trips\/[^/]+\/?$/.test(pathname)) return "travel";
  const match = /^\/play\/([^/]+)\/?$/.exec(pathname);
  return match && isRoomObjectId(match[1]) ? match[1] : null;
}

export function historyRoomObject(): RoomObjectId | null {
  const value = window.history.state?.[ROOM_HISTORY_ORIGIN_KEY];
  return typeof value === "string" && isRoomObjectId(value) ? value : null;
}

export function historyRoomDepth(): number | null {
  const value = window.history.state?.[ROOM_HISTORY_DEPTH_KEY];
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function historyRoomPath(): string | null {
  const value = window.history.state?.[ROOM_HISTORY_PATH_KEY];
  return typeof value === "string" ? value : null;
}

export function markRoomHistoryEntry(id: RoomObjectId, depth = 1) {
  const currentState =
    window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {};
  window.history.replaceState(
    {
      ...currentState,
      [ROOM_HISTORY_ORIGIN_KEY]: id,
      [ROOM_HISTORY_DEPTH_KEY]: depth,
      [ROOM_HISTORY_PATH_KEY]: window.location.pathname,
    },
    "",
    window.location.href,
  );
}

export function clearRoomHistoryEntry() {
  const currentState = window.history.state;
  if (!currentState || typeof currentState !== "object") return;
  if (!(ROOM_HISTORY_ORIGIN_KEY in currentState)) return;
  const nextState = { ...currentState };
  delete nextState[ROOM_HISTORY_ORIGIN_KEY];
  delete nextState[ROOM_HISTORY_DEPTH_KEY];
  delete nextState[ROOM_HISTORY_PATH_KEY];
  window.history.replaceState(nextState, "", window.location.href);
}
