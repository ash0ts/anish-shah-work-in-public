import { DiscogsStream } from "../DiscogsStream";
import type {
  ConnectorState,
  DiscogsPublicSnapshot,
  DiscogsQueryState,
} from "../connector-model";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import { MatchCutSurface } from "./MatchCutSurface";
import { ScreenNavigation } from "./ScreenNavigation";
import styles from "./RoomScreens.module.css";

export default function CollectRoomScreen({
  initialQuery,
  initialState,
}: {
  initialQuery: DiscogsQueryState;
  initialState: ConnectorState<DiscogsPublicSnapshot>;
}) {
  const object = ROOM_OBJECT_BY_ID.collect;
  return (
    <main data-room-screen id="main" className={`${styles.page} ${styles.collectPage}`} tabIndex={-1}>
      <ScreenNavigation object={object} />
      <header className={styles.collectHeader}>
        <p>Discogs · Physical collection</p>
        <h1>{object.title}</h1>
        <span>Physical releases, duplicate copies, formats, and decades in one searchable crate.</span>
      </header>
      <section className={styles.recordCrate} aria-labelledby="collect-status-title">
        <div className={styles.recordSleeves} aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => <i key={index} />)}
        </div>
        <MatchCutSurface
          className={styles.crateFront}
          objectId={object.id}
          surface={object.matchCutSurface}
        >
          <p id="collect-status-title">12″ · 10″ · 7″ · physical catalog</p>
          <DiscogsStream
            initialQuery={initialQuery}
            initialState={initialState}
            routePath="/play/collect"
          />
        </MatchCutSurface>
      </section>
    </main>
  );
}
