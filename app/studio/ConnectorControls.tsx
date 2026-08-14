"use client";

import { DiscogsConnectorPanel } from "./connectors/DiscogsConnectorPanel";
import { HardcoverConnectorPanel } from "./connectors/HardcoverConnectorPanel";
import { MyAnimeListConnectorPanel } from "./connectors/MyAnimeListConnectorPanel";
import { SpotifyConnectorPanel } from "./connectors/SpotifyConnectorPanel";
import { SteamConnectorPanel } from "./connectors/SteamConnectorPanel";
import type { ConnectorControlsProps } from "./connectors/model";

export function ConnectorControls({
  connector,
  view,
  approvalOverview,
  expanded,
  onExpandedChange,
  onPermissionUpdated,
  environment,
  encryptionConfigured,
  discogsCallbackUrl,
  myAnimeListCallbackUrl,
  spotifyCallbackUrl,
  steamStorageCountries,
}: ConnectorControlsProps) {
  const shared = {
    connector,
    view,
    approvalOverview,
    expanded,
    onExpandedChange,
    onPermissionUpdated,
    environment,
    encryptionConfigured,
  };

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
    case "discogs":
      return (
        <DiscogsConnectorPanel {...shared} callbackUrl={discogsCallbackUrl} />
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
