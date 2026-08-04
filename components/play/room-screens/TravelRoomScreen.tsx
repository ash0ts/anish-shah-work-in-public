import type { PublicTravelAtlasEnvelope } from "@/types/travel";
import type { TravelPreviewScenario } from "@/lib/server/travel/preview";
import { SITE_COPY } from "@/lib/copy";
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
        <p>{object.screenEyebrow}</p>
        <h1>{object.title}</h1>
        <span>{SITE_COPY.play["travel-screen-summary"]}</span>
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
