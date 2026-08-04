"use client";

import { useState } from "react";
import type {
  ConnectorState,
  PreviewFixtureScenario,
  StravaPayload,
} from "../connector-model";
import { MovementStream } from "../MovementStream";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import { MatchCutSurface } from "./MatchCutSurface";
import { ScreenNavigation } from "./ScreenNavigation";
import styles from "./RoomScreens.module.css";

export default function MoveRoomScreen({
  initialState,
  fixture,
}: {
  initialState: ConnectorState<StravaPayload>;
  fixture?: PreviewFixtureScenario;
}) {
  const [showStrava, setShowStrava] = useState(false);
  const object = ROOM_OBJECT_BY_ID.move;
  return (
    <main data-room-screen id="main" className={`${styles.page} ${styles.movePage}`} tabIndex={-1}>
      <ScreenNavigation fixture={fixture} object={object} />
      <header className={styles.moveHeader}>
        <p>{object.screenEyebrow}</p>
        <h1>{object.title}</h1>
        <span>{object.description}</span>
      </header>
      <section className={styles.cardioStation} aria-label="Strava movement feed">
        <div className={styles.cardioTelevision}>
          <MatchCutSurface
            className={styles.cardioDisplay}
            objectId={object.id}
            surface={object.matchCutSurface}
          >
            <MovementStream
              fixture={fixture}
              initialState={initialState}
              onShow={() => setShowStrava(true)}
              show={showStrava}
            />
          </MatchCutSurface>
          <div className={styles.cardioControls} aria-hidden="true">
            <span>PACE</span><i /><b>START</b>
          </div>
        </div>
        <div className={styles.treadmillDeck} aria-hidden="true"><i /></div>
      </section>
    </main>
  );
}
