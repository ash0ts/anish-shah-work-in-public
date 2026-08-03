"use client";

import { useRoomExperience } from "./RoomExperienceProvider";
import { useRoomCapability } from "../room-3d/Room3DGate";
import styles from "./RoomOverview.module.css";

export function RoomEntryControl() {
  const room = useRoomExperience();
  const capability = useRoomCapability();
  const checking = capability.reasons.includes("checking");

  if (room.fallbackReason) {
    return (
      <div className={styles.entryControl}>
        <span aria-live="polite">
          The interactive room is staying still for this visit. Choose any of
          the six objects below.
        </span>
      </div>
    );
  }

  if (!capability.eligible) {
    return (
      <div className={styles.entryControl}>
        <span aria-live="polite">
          {checking
            ? "Checking whether this device supports the interactive room. The six links are ready now."
            : "This device is using the still room. Choose any of the six objects below."}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.entryControl}>
      <button
        data-room-enter-control
        onClick={room.enterRoom}
        type="button"
      >
        Enter the room
      </button>
      <span aria-live="polite">
        {room.entered
          ? "Interactive room requested. Use the labeled objects or room controls."
          : "Optional on capable desktop browsers. The six links always work."}
      </span>
    </div>
  );
}
