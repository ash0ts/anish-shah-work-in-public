import type { CollectionPayload, CollectionQueryState, ConnectorState, PreviewFixtureScenario } from "../connector-model";
import { CollectionStream } from "../CollectionStream";
import { ObjectScreen } from "./ObjectScreen";
export default function ReadRoomScreen({ initialState, initialQuery, fixture }: {
  initialState: ConnectorState<CollectionPayload>;
  initialQuery: CollectionQueryState;
  fixture?: PreviewFixtureScenario;
}) {
  return <ObjectScreen id="read" fixture={fixture}>
    <div data-room-collection-presentation="circulation-shelf" id="read-library">
      <CollectionStream fixture={fixture} initialQuery={initialQuery} initialState={initialState} provider="hardcover" routePath="/play/read" />
    </div>
  </ObjectScreen>;
}
