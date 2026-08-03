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
    "Authorize the owner account through MyAnimeList. Studio stores the resulting tokens—not your password—and renews access automatically.",
  recovery:
    "If authorization is denied, start it again. If Studio reports reauthorization required, authorize the stored app again; replace the app credentials only when the registration itself changed.",
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
