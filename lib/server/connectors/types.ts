export const CONNECTOR_PROVIDERS = [
  "myanimelist",
  "hardcover",
  "steam",
] as const;

export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];
export type SyncTrigger =
  | "manual"
  | "stale_revalidate"
  | "schema_upgrade";

export function isConnectorProvider(
  value: string,
): value is ConnectorProvider {
  return CONNECTOR_PROVIDERS.includes(value as ConnectorProvider);
}

export type LegacyMyAnimeListCredential = {
  accessToken: string;
};

export type MyAnimeListOAuthCredential = {
  kind: "oauth";
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
};

export type MyAnimeListCredential =
  | LegacyMyAnimeListCredential
  | MyAnimeListOAuthCredential;

export type HardcoverCredential = {
  authorization: string;
};

export type SteamCredential = {
  apiKey: string;
  steamId: string;
};

export type ConnectorCredential =
  | MyAnimeListCredential
  | HardcoverCredential
  | SteamCredential;

export type ConnectorCredentialInput =
  | string
  | {
      apiKey: string;
      steamId: string;
    };

export type ConnectorFetchResult = {
  publicPayload: Record<string, unknown>;
  itemCount: number;
  etag?: string;
};

export class ConnectorFetchError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      code: string;
      httpStatus?: number | null;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = "ConnectorFetchError";
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
  }
}
