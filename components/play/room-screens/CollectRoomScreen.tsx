import { DiscogsStream } from "../DiscogsStream";
import type {
  ConnectorState,
  DiscogsPublicSnapshot,
  DiscogsQueryState,
  PreviewFixtureScenario,
} from "../connector-model";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import { MatchCutSurface } from "./MatchCutSurface";
import { ScreenNavigation } from "./ScreenNavigation";
import styles from "./RoomScreens.module.css";

export default function CollectRoomScreen({
  initialQuery,
  initialState,
  fixture,
}: {
  initialQuery: DiscogsQueryState;
  initialState: ConnectorState<DiscogsPublicSnapshot>;
  fixture?: PreviewFixtureScenario;
}) {
  const object = ROOM_OBJECT_BY_ID.collect;
  return (
    <main data-room-screen id="main" className={`${styles.page} ${styles.collectPage}`} tabIndex={-1}>
      <ScreenNavigation fixture={fixture} object={object} />
      <header className={styles.collectHeader}>
        <p>Discogs · Physical collection</p>
        <h1>{object.title}</h1>
        <span>{object.description}</span>
      </header>
      <section className={styles.recordCrate} aria-labelledby="collect-status-title">
        <div className={styles.recordSleeves} aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <i key={index}>
              <span />
            </i>
          ))}
        </div>
        <MatchCutSurface
          className={styles.crateFront}
          objectId={object.id}
          surface={object.matchCutSurface}
        >
          <div className={styles.crateLabel}>
            <p id="collect-status-title">Crate 01 · Physical collection</p>
            <span>Cataloged without flattening duplicate copies</span>
          </div>
          <div className={styles.crateWell}>
            <DiscogsStream
              fixture={fixture}
              initialQuery={initialQuery}
              initialState={initialState}
              presentation="crate"
              routePath="/play/collect"
            />
          </div>
          <div className={styles.crateRails} aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
          </div>
        </MatchCutSurface>
      </section>
    </main>
  );
}
