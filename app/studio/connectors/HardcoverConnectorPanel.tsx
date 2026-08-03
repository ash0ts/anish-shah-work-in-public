"use client";

import { ApiConnectorPanel } from "./ApiConnectorPanel";
import type { ProviderMeta, ProviderPanelProps } from "./model";

const meta: ProviderMeta = {
  stream: "Read",
  title: "Hardcover",
  requirement: "API token",
  sources: [
    {
      href: "https://docs.hardcover.app/api/getting-started/",
      label: "Read API setup",
    },
    {
      href: "https://hardcover.app/account/api",
      label: "Copy account token",
    },
  ],
  summary:
    "Connect the owner library with a personal API token. Studio derives the public profile link from the authenticated account.",
  recovery:
    "Tokens expire after one year and reset on January 1; Hardcover may also reset them during beta. If refresh returns 401, copy a current token, choose Replace credential, and refresh again. For rate limits, wait before retrying.",
};

export function HardcoverConnectorPanel(props: ProviderPanelProps) {
  return <ApiConnectorPanel {...props} meta={meta} />;
}
