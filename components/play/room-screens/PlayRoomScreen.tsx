import type {
  CollectionPayload,
  CollectionQueryState,
  ConnectorState,
} from "../connector-model";
import { CollectionStream } from "../CollectionStream";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import { MatchCutSurface } from "./MatchCutSurface";
import { ScreenNavigation } from "./ScreenNavigation";
import styles from "./RoomScreens.module.css";

export default function PlayRoomScreen({
  initialState,
  initialQuery,
}: {
  initialState: ConnectorState<CollectionPayload>;
  initialQuery: CollectionQueryState;
}) {
  const object = ROOM_OBJECT_BY_ID.play;
  return (
    <main data-room-screen id="main" className={`${styles.page} ${styles.playPage}`} tabIndex={-1}>
      <ScreenNavigation object={object} />
      <header className={styles.playHeader}>
        <p>Steam · Public library snapshot</p>
        <h1>{object.title}</h1>
        <span>Games, recent sessions, and rounded time—organized like files on the family computer.</span>
      </header>
      <section className={styles.computer} aria-label="Steam collection">
        <div className={styles.computerBezel}>
          <div className={styles.computerBar} aria-hidden="true">
            <span>MY GAMES</span><i>_ □ ×</i>
          </div>
          <MatchCutSurface
            className={styles.computerDisplay}
            objectId={object.id}
            surface={object.matchCutSurface}
          >
            <CollectionStream
              initialQuery={initialQuery}
              initialState={initialState}
              provider="steam"
              routePath="/play/play"
            />
          </MatchCutSurface>
          <div className={styles.computerBadge} aria-hidden="true">POWER ●</div>
        </div>
        <div className={styles.computerStand} aria-hidden="true"><i /><b /></div>
      </section>
    </main>
  );
}
