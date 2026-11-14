import { DiscogsStream } from "../DiscogsStream";
import type { ConnectorState, DiscogsPublicSnapshot, DiscogsQueryState, PreviewFixtureScenario } from "../connector-model";
import { ObjectScreen } from "./ObjectScreen";
export default function CollectRoomScreen({ initialQuery, initialState, fixture }: {
  initialQuery: DiscogsQueryState;
  initialState: ConnectorState<DiscogsPublicSnapshot>;
  fixture?: PreviewFixtureScenario;
}) {
  return <ObjectScreen id="collect" fixture={fixture}>
    <DiscogsStream fixture={fixture} initialQuery={initialQuery} initialState={initialState} presentation="crate" routePath="/play/collect" />
  </ObjectScreen>;
}
