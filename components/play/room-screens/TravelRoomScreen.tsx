import type { PublicTravelAtlasEnvelope } from "@/types/travel";
import type { TravelPreviewScenario } from "@/lib/server/travel/preview";
import { PostcardPlanet } from "../travel/PostcardPlanet";
import { TravelNoScriptAtlas } from "../travel/TravelNoScriptAtlas";
import { ObjectScreen } from "./ObjectScreen";
export default function TravelRoomScreen({ initialState, previewFixture }: {
  initialState: PublicTravelAtlasEnvelope;
  previewFixture?: TravelPreviewScenario;
}) {
  return <ObjectScreen id="travel">
    <PostcardPlanet initialState={initialState} previewFixture={previewFixture} />
    {initialState.status === "ready" ? <TravelNoScriptAtlas atlas={initialState.atlas} previewFixture={previewFixture} /> : null}
  </ObjectScreen>;
}
