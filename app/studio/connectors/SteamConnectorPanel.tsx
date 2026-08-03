"use client";

import { ApiConnectorPanel } from "./ApiConnectorPanel";
import type { ProviderMeta, ProviderPanelProps } from "./model";

const meta: ProviderMeta = {
  stream: "Play",
  title: "Steam",
  requirement: "Web API key + SteamID64",
  sources: [
    {
      href: "https://partner.steamgames.com/doc/webapi_overview",
      label: "Read Web API setup",
    },
    {
      href: "https://steamcommunity.com/dev/apikey",
      label: "Register owner key",
    },
    {
      href: "https://help.steampowered.com/en/faqs/view/2816-BE67-5B69-0FEC",
      label: "Find account details",
    },
  ],
  summary:
    "Publish a bounded view of public game details: rounded totals and a short list of recent and top-played games.",
  recovery:
    "If visibility is required, make both Profile and Game details Public, then refresh. A private library is unpublished immediately; a disconnected stream is deleted.",
};

type Props = ProviderPanelProps & {
  steamStorageCountries: string | null;
};

export function SteamConnectorPanel({
  steamStorageCountries,
  ...props
}: Props) {
  return (
    <ApiConnectorPanel
      {...props}
      meta={meta}
      steamStorageCountries={steamStorageCountries}
    />
  );
}
