export const CONNECTOR_PROVIDERS = ["myanimelist", "hardcover"] as const;

export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];
export type SyncTrigger = "manual" | "stale_revalidate";

export function isConnectorProvider(
  value: string,
): value is ConnectorProvider {
  return CONNECTOR_PROVIDERS.includes(value as ConnectorProvider);
}

export type MyAnimeListCredential = {
  accessToken: string;
};

export type HardcoverCredential = {
  authorization: string;
};

export type ConnectorCredential =
  | MyAnimeListCredential
  | HardcoverCredential;

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
