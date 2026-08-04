import type { PublicTravelAtlasEnvelope } from "@/types/travel";
import type { TravelPreviewScenario } from "@/lib/server/travel/preview";
import { PostcardPlanet } from "../travel/PostcardPlanet";
import { TravelNoScriptAtlas } from "../travel/TravelNoScriptAtlas";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import { MatchCutSurface } from "./MatchCutSurface";
import { ScreenNavigation } from "./ScreenNavigation";
import styles from "./RoomScreens.module.css";

export default function TravelRoomScreen({
  initialState,
  previewFixture,
}: {
  initialState: PublicTravelAtlasEnvelope;
  previewFixture?: TravelPreviewScenario;
}) {
  const object = ROOM_OBJECT_BY_ID.travel;
  return (
    <main
      className={`${styles.page} ${styles.travelPage}`}
      data-room-screen
      id="main"
      tabIndex={-1}
    >
      <ScreenNavigation object={object} />
      <header className={styles.travelHeader}>
        <p>Travel signal · Approximate public geography</p>
        <h1>{object.title}</h1>
        <span>
          Spin a public travel log, open a country, and follow photographs back
          to the trips that made them.
        </span>
      </header>
      <MatchCutSurface
        className={styles.planetSurface}
        objectId={object.id}
        surface={object.matchCutSurface}
      >
        <PostcardPlanet
          initialState={initialState}
          previewFixture={previewFixture}
        />
        {initialState.status === "ready" ? (
          <TravelNoScriptAtlas
            atlas={initialState.atlas}
            previewFixture={previewFixture}
          />
        ) : null}
      </MatchCutSurface>
    </main>
  );
}
