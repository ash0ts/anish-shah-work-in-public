import type { SpotifyState } from "@/components/spotify/model";
import { SpotifyStream } from "@/components/SpotifyStream";
import type { PreviewFixtureScenario } from "../connector-model";
import { ObjectScreen } from "./ObjectScreen";
export default function ListenRoomScreen({ initialState, fixture }: { initialState: SpotifyState; fixture?: PreviewFixtureScenario; }) {
  return <ObjectScreen id="listen" fixture={fixture}><SpotifyStream fixture={fixture} initialState={initialState} /></ObjectScreen>;
}
