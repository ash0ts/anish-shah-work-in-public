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

export default function ReadRoomScreen({
  initialState,
  initialQuery,
  fixture,
}: {
  initialState: ConnectorState<CollectionPayload>;
  initialQuery: CollectionQueryState;
  fixture?: PreviewFixtureScenario;
}) {
  const object = ROOM_OBJECT_BY_ID.read;
  return (
    <main data-room-screen id="main" className={`${styles.page} ${styles.readPage}`} tabIndex={-1}>
      <ScreenNavigation fixture={fixture} object={object} />
      <header className={styles.readHeader} id="read-desk-note">
        <p>{object.screenEyebrow}</p>
        <h1>{object.title}</h1>
        <span>{object.description}</span>
      </header>
      <section className={styles.bookshelf} aria-label="Hardcover collection">
        <div className={styles.shelfCrown} aria-hidden="true">
          <span>ASH · PERSONAL LIBRARY</span>
          <i />
        </div>
        <div className={styles.shelfComposition}>
          <aside className={styles.circulationCard} aria-label="Shelf directory">
            <p>Circulation file</p>
            <nav aria-label={`${object.title} sections`}>
              <a href="#read-desk-note">Desk note</a>
              <a href="#read-library">Browse the shelf</a>
            </nav>
            <dl>
              <div>
                <dt>Catalog</dt>
                <dd>Hardcover</dd>
              </div>
              <div>
                <dt>Collection</dt>
                <dd>My shelf</dd>
              </div>
            </dl>
          </aside>
          <MatchCutSurface
            className={styles.shelfInterior}
            objectId={object.id}
            surface={object.matchCutSurface}
          >
            <div
              className={styles.readCatalog}
              data-room-collection-presentation="circulation-shelf"
              id="read-library"
            >
              <CollectionStream
                fixture={fixture}
                initialQuery={initialQuery}
                initialState={initialState}
                provider="hardcover"
                routePath="/play/read"
              />
            </div>
          </MatchCutSurface>
        </div>
        <div className={styles.shelfFeet} aria-hidden="true"><i /><i /></div>
      </section>
    </main>
  );
}
