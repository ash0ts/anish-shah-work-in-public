import type { CollectionPayload, CollectionQueryState, ConnectorState, PreviewFixtureScenario } from "../connector-model";
import { CollectionStream } from "../CollectionStream";
import { ObjectScreen } from "./ObjectScreen";
export default function WatchRoomScreen({ initialState, initialQuery, fixture }: {
  initialState: ConnectorState<CollectionPayload>;
  initialQuery: CollectionQueryState;
  fixture?: PreviewFixtureScenario;
}) {
  return <ObjectScreen id="watch" fixture={fixture}>
    <div data-room-collection-presentation="broadcast-guide" id="watch-library">
      <CollectionStream fixture={fixture} initialQuery={initialQuery} initialState={initialState} provider="myanimelist" routePath="/play/watch" />
    </div>
  </ObjectScreen>;
}
