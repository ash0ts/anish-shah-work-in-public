"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { SITE_COPY } from "@/lib/copy";
import { useRoomExperience } from "./RoomExperienceProvider";
import { shouldOpenRoom } from "./room-entry-policy";
import { useRoomCapability } from "../room-3d/Room3DGate";
import styles from "./RoomOverview.module.css";

export function RoomEntryControl({ directory = false, href = "/play" }: { directory?: boolean; href?: string }) {
  const room = useRoomExperience();
  const capability = useRoomCapability();
  const attempted = useRef(false);
  useEffect(() => {
    if (directory) { attempted.current = false; return; }
    if (!shouldOpenRoom({ directory, eligible: capability.eligible,
      entered: room.entered, failed: Boolean(room.fallbackReason),
      attempted: attempted.current })) return;
    attempted.current = true;
    room.enterRoom();
  }, [directory, capability.eligible, room]);

  if (directory && capability.eligible && !room.fallbackReason) {
    return <Link className={styles.entryLink} href={href} prefetch={false}
      onClick={() => { attempted.current = false; }} data-room-enter-control>
      {SITE_COPY.play["room-open-control"]}
    </Link>;
  }
  return <span className={styles.entryStatus} role="status">
    {capability.reasons.includes("checking") || room.entered
      ? SITE_COPY.play["room-opening-status"]
      : SITE_COPY.play["room-fallback-body"]}
  </span>;
}
