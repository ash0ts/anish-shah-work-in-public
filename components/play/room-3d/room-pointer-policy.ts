export type RoomInteractivePointerType = "mouse" | "pen" | "touch";

/**
 * The room is a desktop progressive enhancement. Touch input remains owned by
 * the document and the visible semantic controls instead of the WebGL stage.
 */
export function isRoomInteractivePointer(
  pointerType: string,
  allowTouch = false,
): pointerType is RoomInteractivePointerType {
  return (
    pointerType === "mouse" ||
    pointerType === "pen" ||
    (allowTouch && pointerType === "touch")
  );
}

export function isCompetingRoomPointer(
  activePointerId: number | null,
  incomingPointerId: number,
) {
  return activePointerId !== null && activePointerId !== incomingPointerId;
}
