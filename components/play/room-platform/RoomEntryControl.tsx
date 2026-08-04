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
          The room is staying still on this device. Every labeled object below
          still opens.
        </span>
      </div>
    );
  }

  if (!capability.eligible) {
    return (
      <div className={styles.entryControl}>
        <span aria-live="polite">
          {checking
            ? "Checking whether this device can open the 3D room. Every labeled object below is ready now."
            : "The room is staying still on this device. Every labeled object below still opens."}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.entryControl} data-room-entry-tier={capability.tier}>
      <button
        data-room-enter-control
        onClick={room.enterRoom}
        type="button"
      >
        {capability.tier === "pocket"
          ? "Open the pocket room"
          : "Enter the room"}
      </button>
      <span aria-live="polite">
        {room.entered
          ? capability.tier === "pocket"
            ? "The Pocket Room is opening. The labeled objects and room controls are ready."
            : "The 3D room is opening. The labeled objects and room controls are ready."
          : capability.tier === "pocket"
            ? "Optional touch-sized 3D room. Every object also opens as a regular page."
            : "Optional 3D view on supported desktops. Every object also opens as a regular page."}
      </span>
    </div>
  );
}
