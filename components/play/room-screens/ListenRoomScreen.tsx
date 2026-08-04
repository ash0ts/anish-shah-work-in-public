import type { SpotifyState } from "@/components/spotify/model";
import { SpotifyStream } from "@/components/SpotifyStream";
import type { PreviewFixtureScenario } from "../connector-model";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import { MatchCutSurface } from "./MatchCutSurface";
import { ScreenNavigation } from "./ScreenNavigation";
import styles from "./RoomScreens.module.css";

export default function ListenRoomScreen({
  initialState,
  fixture,
}: {
  initialState: SpotifyState;
  fixture?: PreviewFixtureScenario;
}) {
  const object = ROOM_OBJECT_BY_ID.listen;
  return (
    <main data-room-screen id="main" className={`${styles.page} ${styles.listenPage}`} tabIndex={-1}>
      <ScreenNavigation fixture={fixture} object={object} />
      <header className={styles.listenHeader}>
        <p>Spotify · One returned order at a time</p>
        <h1>{object.title}</h1>
        <span>{object.description}</span>
      </header>
      <section className={styles.pocketPlayer} aria-label="Spotify Top Tracks">
        <div className={styles.playerTop} aria-hidden="true">
          <span>LISTEN</span><i />
        </div>
        <MatchCutSurface
          className={styles.playerDisplay}
          objectId={object.id}
          surface={object.matchCutSurface}
        >
          <SpotifyStream fixture={fixture} initialState={initialState} />
        </MatchCutSurface>
        <div className={styles.playerWheel} aria-hidden="true">
          <span>MENU</span><i /><b>▶</b>
        </div>
      </section>
    </main>
  );
}
