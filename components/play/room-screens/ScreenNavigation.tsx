"use client";

import Link from "next/link";
import type { PreviewFixtureScenario } from "../connector-model";
import { routeWithPreviewFixture } from "../room-platform/preview-fixture-navigation";
import { ROOM_OBJECTS } from "../room-platform/room-registry";
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
        aria-label="Back to room"
        className={styles.roomBack}
        data-room-screen-entry-focus
        data-room-return
        href={routeWithPreviewFixture("/play", fixture)}
        onClick={(event) => {
          event.preventDefault();
          room.returnToRoom();
        }}
        prefetch={false}
      >
        <span aria-hidden="true">←</span>
        <span>Room</span>
      </Link>
      <span className={styles.screenCurrent}>
        {object.object} · {object.label}
      </span>
      <details className={styles.objectSwitcher}>
        <summary>Objects</summary>
        <ul>
          {ROOM_OBJECTS.filter((candidate) =>
            room.enabledObjectIds.includes(candidate.id),
          ).map((candidate) => (
            <li key={candidate.id}>
              <Link
                aria-current={candidate.id === object.id ? "page" : undefined}
                data-room-object-screen-link={candidate.id}
                href={routeWithPreviewFixture(candidate.route, fixture)}
                prefetch={false}
              >
                <span>{candidate.object}</span>
                <small>{candidate.label}</small>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
