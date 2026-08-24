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
    "Connect the owner library with a personal API token. The authenticated account supplies the public profile link.",
  recovery:
    "Tokens expire after one year and reset on January 1; Hardcover may also reset them during beta. A 401 needs a current token: replace the credential, then refresh. After a rate limit, wait before retrying.",
};

export function HardcoverConnectorPanel(props: ProviderPanelProps) {
  return <ApiConnectorPanel {...props} meta={meta} />;
}
