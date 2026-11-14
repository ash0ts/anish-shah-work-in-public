import type { CollectionPayload, CollectionQueryState, ConnectorState, PreviewFixtureScenario } from "../connector-model";
import { CollectionStream } from "../CollectionStream";
import { ObjectScreen } from "./ObjectScreen";
export default function PlayRoomScreen({ initialState, initialQuery, fixture }: {
  initialState: ConnectorState<CollectionPayload>;
  initialQuery: CollectionQueryState;
  fixture?: PreviewFixtureScenario;
}) {
  return <ObjectScreen id="play" fixture={fixture}>
    <div data-room-collection-presentation="desktop-library" id="play-library">
      <CollectionStream fixture={fixture} initialQuery={initialQuery} initialState={initialState} provider="steam" routePath="/play/play" />
    </div>
  </ObjectScreen>;
}
