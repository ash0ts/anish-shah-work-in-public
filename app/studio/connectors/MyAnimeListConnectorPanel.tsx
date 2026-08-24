"use client";

import { ApiConnectorPanel } from "./ApiConnectorPanel";
import type { ProviderMeta, ProviderPanelProps } from "./model";

const meta: ProviderMeta = {
  stream: "Watch",
  title: "MyAnimeList",
  requirement: "Client ID + client secret",
  sources: [
    {
      href: "https://myanimelist.net/apiconfig",
      label: "Open developer portal",
    },
  ],
  summary:
    "Connect the owner account. Studio stores the resulting tokens—never the password—and renews access automatically.",
  recovery:
    "If authorization is denied, start again. When reauthorization is required, authorize the stored app; replace app credentials only if the registration changed.",
};

type Props = ProviderPanelProps & {
  callbackUrl: string | null;
};

export function MyAnimeListConnectorPanel({ callbackUrl, ...props }: Props) {
  return (
    <ApiConnectorPanel
      {...props}
      meta={meta}
      oauth={{
        provider: "myanimelist",
        title: "MyAnimeList",
        startPath: "/api/studio/connectors/myanimelist/oauth/start",
        callbackUrl,
      }}
    />
  );
}
