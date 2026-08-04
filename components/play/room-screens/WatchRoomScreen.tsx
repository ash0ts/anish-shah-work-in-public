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

export default function WatchRoomScreen({
  initialState,
  initialQuery,
  fixture,
}: {
  initialState: ConnectorState<CollectionPayload>;
  initialQuery: CollectionQueryState;
  fixture?: PreviewFixtureScenario;
}) {
  const object = ROOM_OBJECT_BY_ID.watch;
  return (
    <main data-room-screen id="main" className={`${styles.page} ${styles.watchPage}`} tabIndex={-1}>
      <ScreenNavigation fixture={fixture} object={object} />
      <header className={styles.watchHeader} id="watch-program-note">
        <p>{object.screenEyebrow}</p>
        <h1>{object.title}</h1>
        <span>{object.description}</span>
      </header>
      <section className={styles.television} aria-label="MyAnimeList collection">
        <div className={styles.televisionControls} aria-hidden="true">
          <i />
          <b>CH 11</b>
          <span>● ● ●</span>
        </div>
        <div className={styles.broadcastGuide}>
          <nav aria-label={`${object.title} sections`}>
            <a href="#watch-program-note">Program note</a>
            <a href="#watch-library">Watch library</a>
          </nav>
          <p>
            <span>11:00 PM</span>
            <strong>Anime library</strong>
            <b>On air</b>
          </p>
        </div>
        <MatchCutSurface
          className={styles.televisionGlass}
          objectId={object.id}
          surface={object.matchCutSurface}
        >
          <div
            className={styles.watchProgram}
            data-room-collection-presentation="broadcast-guide"
            id="watch-library"
          >
            <CollectionStream
              fixture={fixture}
              initialQuery={initialQuery}
              initialState={initialState}
              provider="myanimelist"
              routePath="/play/watch"
            />
          </div>
        </MatchCutSurface>
      </section>
    </main>
  );
}
