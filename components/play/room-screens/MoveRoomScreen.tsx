"use client";
import { useState } from "react";
import type { ConnectorState, PreviewFixtureScenario, StravaPayload } from "../connector-model";
import { MovementStream } from "../MovementStream";
import { ObjectScreen } from "./ObjectScreen";
export default function MoveRoomScreen({ initialState, fixture }: {
  initialState: ConnectorState<StravaPayload>;
  fixture?: PreviewFixtureScenario;
}) {
  const [showStrava, setShowStrava] = useState(false);
  return <ObjectScreen id="move" fixture={fixture}>
    <MovementStream fixture={fixture} initialState={initialState} onShow={() => setShowStrava(true)} show={showStrava} />
  </ObjectScreen>;
}
