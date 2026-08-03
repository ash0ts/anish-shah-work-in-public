"use client";

import { HardcoverConnectorPanel } from "./connectors/HardcoverConnectorPanel";
import { MyAnimeListConnectorPanel } from "./connectors/MyAnimeListConnectorPanel";
import { SpotifyConnectorPanel } from "./connectors/SpotifyConnectorPanel";
import { SteamConnectorPanel } from "./connectors/SteamConnectorPanel";
import type { ConnectorControlsProps } from "./connectors/model";

export function ConnectorControls({
  connector,
  environment,
  encryptionConfigured,
  myAnimeListCallbackUrl,
  spotifyCallbackUrl,
  steamStorageCountries,
}: ConnectorControlsProps) {
  const shared = { connector, environment, encryptionConfigured };

  switch (connector.provider) {
    case "myanimelist":
      return (
        <MyAnimeListConnectorPanel
          {...shared}
          callbackUrl={myAnimeListCallbackUrl}
        />
      );
    case "hardcover":
      return <HardcoverConnectorPanel {...shared} />;
    case "spotify":
      return (
        <SpotifyConnectorPanel {...shared} callbackUrl={spotifyCallbackUrl} />
      );
    case "steam":
      return (
        <SteamConnectorPanel
          {...shared}
          steamStorageCountries={steamStorageCountries}
        />
      );
  }
}

export { StravaConnectorControls } from "./connectors/StravaConnectorPanel";
