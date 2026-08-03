"use client";

import Link from "next/link";
import type { PreviewFixtureScenario } from "../connector-model";
import { routeWithPreviewFixture } from "../room-platform/preview-fixture-navigation";
import type { RoomObjectDefinition } from "../room-platform/room-types";
import { useRoomExperience } from "../room-platform/RoomExperienceProvider";
import styles from "./RoomScreens.module.css";

export function ScreenNavigation({
  object,
  fixture,
}: {
  object: RoomObjectDefinition;
  fixture?: PreviewFixtureScenario;
}) {
  const room = useRoomExperience();
  return (
    <nav className={styles.screenNavigation} aria-label="Room navigation">
      <Link
        data-room-screen-entry-focus
        data-room-return
        href={routeWithPreviewFixture("/play", fixture)}
        onClick={(event) => {
          event.preventDefault();
          room.returnToRoom();
        }}
        prefetch={false}
      >
        ← Back to room
      </Link>
      <span>
        {object.object} · {object.label}
      </span>
    </nav>
  );
}
