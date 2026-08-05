import type {
  CollectionPayload,
  CollectionQueryState,
  ConnectorState,
  PreviewFixtureScenario,
} from "../connector-model";
import { CollectionStream } from "../CollectionStream";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import { MatchCutSurface } from "./MatchCutSurface";
import { ScreenNavigation } from "./ScreenNavigation";
import styles from "./RoomScreens.module.css";

export default function PlayRoomScreen({
  initialState,
  initialQuery,
  fixture,
}: {
  initialState: ConnectorState<CollectionPayload>;
  initialQuery: CollectionQueryState;
  fixture?: PreviewFixtureScenario;
}) {
  const object = ROOM_OBJECT_BY_ID.play;
  return (
    <main data-room-screen id="main" className={`${styles.page} ${styles.playPage}`} tabIndex={-1}>
      <ScreenNavigation fixture={fixture} object={object} />
      <header className={styles.playHeader} id="play-system-note">
        <p>{object.screenEyebrow}</p>
        <h1>{object.title}</h1>
        <span>{object.description}</span>
      </header>
      <section className={styles.computer} aria-label="Steam collection">
        <div className={styles.computerBezel}>
          <div className={styles.computerBar} aria-hidden="true">
            <span>C:\ASH\MY_GAMES</span><i>_ □ ×</i>
          </div>
          <div className={styles.desktopWorkspace}>
            <nav className={styles.desktopShortcuts} aria-label={`${object.title} shortcuts`}>
              <a href="#play-system-note">
                <span aria-hidden="true">?</span>
                System note
              </a>
              <a href="#play-library">
                <span aria-hidden="true">▦</span>
                Game library
              </a>
            </nav>
            <MatchCutSurface
              className={styles.computerDisplay}
              objectId={object.id}
              surface={object.matchCutSurface}
            >
              <div
                className={styles.desktopProgram}
                data-room-collection-presentation="desktop-library"
                id="play-library"
              >
                <CollectionStream
                  fixture={fixture}
                  initialQuery={initialQuery}
                  initialState={initialState}
                  provider="steam"
                  routePath="/play/play"
                />
              </div>
            </MatchCutSurface>
          </div>
          <div className={styles.computerTaskbar} aria-hidden="true">
            <b>START</b>
            <span>MY_GAMES.EXE</span>
            <i>GAME LIBRARY</i>
          </div>
          <div className={styles.computerBadge} aria-hidden="true">POWER ●</div>
        </div>
        <div className={styles.computerStand} aria-hidden="true"><i /><b /></div>
      </section>
    </main>
  );
}
